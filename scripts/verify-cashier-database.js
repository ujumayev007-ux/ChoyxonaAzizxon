/*
 * Haqiqiy PostgreSQL sxemasida kassir to‘lovini tekshirish.
 * Ishga tushirish: node scripts/verify-cashier-database.js
 * Barcha sinov yozuvlari bitta tranzaksiyada yaratiladi va HAR DOIM bekor
 * qilinadi. Mavjud restoran yozuvlari o‘qilmaydi yoki o‘zgartirilmaydi.
 * Socket.io va tashqi xabarlar taqlid qilinadi; haqiqiy Prisma/Express
 * to‘lov marshruti, chek, audit va kassa yozuvlari ishlatiladi.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { Prisma, PrismaClient, OrderStatus, OrderSource, OrderType, RoleType } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
require('ts-node/register/transpile-only');

const client = new PrismaClient({ log: [] });
const rollback = new Error('CASHIER_DATABASE_VERIFY_ROLLBACK');
const fixtures = new Map();
const events = [];
const checks = [];
let txClient;
let cashier;
let server;
let origin;
let stage = 'Ulanish';
let failure;
let rollbackRequested = false;
let suppressedRouteErrors = 0;
let routeErrorCode = '';
const originalConsoleError = console.error;

function track(model, rows) {
    if (!fixtures.has(model)) fixtures.set(model, new Set());
    for (const row of Array.isArray(rows) ? rows : [rows]) fixtures.get(model).add(row.id);
    return rows;
}

function stub(relative, exports) {
    const filename = require.resolve(path.join(root, 'src', relative));
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const prisma = new Proxy({}, {
    get(_target, key) {
        if (key === '$transaction') return async operation => {
            assert.equal(typeof operation, 'function');
            return operation(txClient);
        };
        if (!txClient) throw new Error('VERIFY_TRANSACTION_NOT_STARTED');
        const value = txClient[key];
        return typeof value === 'function' ? value.bind(txClient) : value;
    }
});
const next = (_req, _res, proceed) => proceed();
stub('utils/db.ts', { prisma });
stub('middleware/auth.ts', {
    authenticateToken(req, _res, proceed) { req.user = cashier; proceed(); },
    requireCashierAccess: next, requireRole: () => next,
    clearTerminalAdminCookie() {}, setTerminalAdminCookie() {}
});
stub('socket.ts', { emitSocketEvent(event, payload) { events.push({ event, payload }); } });
stub('utils/telegram.ts', { formatTelegramMessage() { return ''; }, async sendToActiveSubscribers() {} });

async function request(route, body) {
    const response = await fetch(`${origin}/api/cashier${route}`, {
        method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(90000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
}

function payment(order, rows, expectedRemaining = order.totalAmount.toFixed(2)) {
    return { orderId: order.id, payments: rows, expectedRemaining, idempotencyKey: randomUUID() };
}

async function assertSettlement(order, expectedPayments, expectedStatus, expectedReceipts = 1) {
    const saved = await txClient.order.findUnique({ where: { id: order.id } });
    assert.equal(saved.status, expectedStatus);
    assert.equal(saved.processingById, null);
    assert.equal(saved.paidAt !== null, expectedStatus === OrderStatus.TOLANDI);
    const rows = track('payment', await txClient.payment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }));
    assert.equal(rows.length, expectedPayments.length);
    for (let index = 0; index < rows.length; index++) {
        assert.equal(rows[index].method, expectedPayments[index].method);
        assert(rows[index].amount.equals(expectedPayments[index].amount));
        assert.equal(rows[index].cashierId, cashier.id);
    }
    const cashRows = expectedPayments.filter(row => row.method === 'NAQD');
    const movements = track('cashMovement', await txClient.cashMovement.findMany({ where: { userId: cashier.id, referenceId: order.id } }));
    assert.equal(movements.length, cashRows.length);
    for (const movement of movements) {
        assert.equal(movement.type, 'SALE');
        assert.equal(movement.userId, cashier.id);
        assert.equal(movement.sessionId, [...fixtures.get('cashSession')][0]);
    }
    assert(movements.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
        .equals(cashRows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))));
    const receipts = track('receipt', await txClient.receipt.findMany({ where: { orderId: order.id } }));
    const printJobs = track('printJob', await txClient.printJob.findMany({ where: { orderId: order.id } }));
    const audits = track('auditLog', await txClient.auditLog.findMany({ where: { userId: cashier.id, entityId: order.id } }));
    const records = track('idempotencyRecord', await txClient.idempotencyRecord.findMany({ where: { userId: cashier.id, resourceId: order.id } }));
    const history = track('orderStatusHistory', await txClient.orderStatusHistory.findMany({ where: { orderId: order.id } }));
    track('orderItem', await txClient.orderItem.findMany({ where: { orderId: order.id } }));
    assert.equal(receipts.length, expectedReceipts);
    assert.equal(printJobs.length, expectedReceipts);
    assert.equal(audits.filter(row => row.action === 'PAYMENT_RECEIVED').length, expectedReceipts);
    assert.equal(records.length, expectedReceipts);
    assert.equal(history.filter(row => row.userId === cashier.id && row.comment.startsWith('Kassir')).length, expectedReceipts);
    assert(printJobs.every(row => row.jobType === 'RECEIPT' && row.status === 'KUTILMOQDA'));
    return { saved, rows, receipts, printJobs, records };
}

async function runChecks(tx) {
    txClient = tx;
    const prefix = `payment_verify_${randomUUID()}`;
    stage = 'Vaqtinchalik ma’lumotlar';
    cashier = track('user', await tx.user.create({ data: {
        id: randomUUID(), username: `${prefix}_cashier`, passwordHash: prefix,
        fullName: 'Sinov kassiri', role: RoleType.CASHIER
    } }));
    const waiter = track('user', await tx.user.create({ data: {
        id: randomUUID(), username: `${prefix}_waiter`, passwordHash: prefix,
        fullName: 'Sinov ofitsianti', role: RoleType.WAITER
    } }));
    const room = track('room', await tx.room.create({ data: { id: randomUUID(), name: prefix } }));
    const table = track('table', await tx.table.create({ data: {
        id: randomUUID(), number: 'SINOV', roomId: room.id, qrCodeToken: randomUUID()
    } }));
    const category = track('menuCategory', await tx.menuCategory.create({ data: { id: randomUUID(), name: prefix } }));
    const menus = {};
    for (const [key, price] of Object.entries({ normal: '100.25', decimal: '0.10', fractional: '0.03' })) {
        menus[key] = track('menuItem', await tx.menuItem.create({ data: {
            id: randomUUID(), name: `${prefix}_${key}`, categoryId: category.id, sellingPrice: price
        } }));
    }
    track('cashSession', await tx.cashSession.create({ data: {
        id: randomUUID(), cashierId: cashier.id, activeCashierId: cashier.id, startingBalance: '0'
    } }));

    async function waiterOrder(menu = menus.normal, quantity = '1') {
        const total = menu.sellingPrice.mul(quantity).toDecimalPlaces(2);
        return track('order', await tx.order.create({ data: {
            id: randomUUID(), orderNumber: `${prefix}_${randomUUID()}`, tableId: table.id,
            waiterId: waiter.id, createdById: waiter.id, source: OrderSource.WAITER,
            orderType: OrderType.DINE_IN, status: OrderStatus.YANGI, subtotal: total, totalAmount: total,
            items: { create: { menuItemId: menu.id, quantity, unitPrice: menu.sellingPrice, totalPrice: total } },
            statusHistory: { create: { status: OrderStatus.YANGI, userId: waiter.id, comment: 'Sinov buyurtmasi' } }
        } }));
    }

    const cashOrder = await waiterOrder();
    stage = 'Ofitsiant buyurtmasi va bandlash';
    const before = await request(`/orders?id=${cashOrder.id}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.data.length, 1);
    assert.equal(before.body.data[0].source, OrderSource.WAITER);
    assert.equal(before.body.data[0].totalAmount, '100.25');
    assert.deepEqual(before.body.data[0].payments, []);
    assert.equal((await request(`/orders/${cashOrder.id}/lock`, {})).status, 200);
    const locked = await tx.order.findUnique({ where: { id: cashOrder.id } });
    assert.equal(locked.processingById, cashier.id);
    checks.push('Ofitsiant buyurtmasi kassaga to‘g‘ri yetib keladi');

    stage = 'Naqd to‘lov';
    const cashBody = payment(cashOrder, [{ method: 'NAQD', amount: '100.25', customerGiven: '150.50' }]);
    const cashResult = await request('/payments', cashBody);
    assert.equal(cashResult.status, 200);
    assert.equal(cashResult.body.data.remaining, '0');
    assert.equal(cashResult.body.data.change, '50.25');
    const cashSaved = await assertSettlement(cashOrder, cashBody.payments, OrderStatus.TOLANDI);
    assert(cashSaved.rows[0].customerGiven.equals('150.50'));
    assert(cashSaved.rows[0].changeAmount.equals('50.25'));
    const printPayload = JSON.parse(cashSaved.printJobs[0].payload);
    assert.equal(printPayload.change, '50.25');
    assert.equal(printPayload.waiter, waiter.fullName);
    for (const event of ['paymentReceived', 'orderUpdate', 'order_status_updated', 'table_status_updated']) {
        assert(events.some(entry => entry.event === event &&
            (entry.payload.orderId === cashOrder.id || entry.payload.tableId === table.id)));
    }
    checks.push('Naqd to‘lov, Qaytim, chek, audit, kassa va Socket.io');

    stage = 'Takroriy to‘lov';
    const eventCount = events.length;
    const retry = await request('/payments', cashBody);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.deepEqual(retry.body.data, cashResult.body.data);
    assert.equal(events.length, eventCount);
    await assertSettlement(cashOrder, cashBody.payments, OrderStatus.TOLANDI);
    const paidView = await request(`/orders?id=${cashOrder.id}`);
    assert.equal(paidView.body.data[0].status, OrderStatus.TOLANDI);
    assert.equal(paidView.body.data[0].payments.length, 1);
    checks.push('Takroriy so‘rov to‘lovni ikkinchi marta yozmaydi');

    for (const method of ['PLASTIK', 'ELEKTRON']) {
        stage = `${method} to‘lov`;
        const order = await waiterOrder();
        const body = payment(order, [{ method, amount: '100.25' }]);
        const result = await request('/payments', body);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.remaining, '0');
        await assertSettlement(order, body.payments, OrderStatus.TOLANDI);
        checks.push(`${method === 'PLASTIK' ? 'Karta' : 'Elektron'} to‘lov haqiqiy bazada saqlanadi`);
    }

    stage = 'Qisman to‘lov va eski qoldiq';
    const partialOrder = await waiterOrder();
    const firstRows = [{ method: 'PLASTIK', amount: '40.10' }];
    const partial = await request('/payments', payment(partialOrder, firstRows));
    assert.equal(partial.status, 200);
    assert.equal(partial.body.data.remaining, '60.15');
    await assertSettlement(partialOrder, firstRows, OrderStatus.QISMAN_TOLANDI);
    const secondRows = [{ method: 'ELEKTRON', amount: '60.15' }];
    const stale = await request('/payments', payment(partialOrder, secondRows));
    assert.equal(stale.status, 409);
    await assertSettlement(partialOrder, firstRows, OrderStatus.QISMAN_TOLANDI);
    const rest = await request('/payments', payment(partialOrder, secondRows, '60.15'));
    assert.equal(rest.status, 200);
    assert.equal(rest.body.data.remaining, '0');
    await assertSettlement(partialOrder, [...firstRows, ...secondRows], OrderStatus.TOLANDI, 2);
    checks.push('Qisman to‘lov, Qoldiq va eski summa bilan so‘rovni rad etish');

    stage = 'Kasrli aralash to‘lov';
    const decimalOrder = await waiterOrder(menus.decimal, '3');
    const decimalRows = [
        { method: 'NAQD', amount: '0.10', customerGiven: '1.00' },
        { method: 'PLASTIK', amount: '0.10' }, { method: 'ELEKTRON', amount: '0.10' }
    ];
    const decimalResult = await request('/payments', payment(decimalOrder, decimalRows));
    assert.equal(decimalResult.status, 200);
    assert.equal(decimalResult.body.data.change, '0.9');
    const decimalSaved = await assertSettlement(decimalOrder, decimalRows, OrderStatus.TOLANDI);
    assert(decimalSaved.rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).equals('0.30'));
    checks.push('Kasrli aralash to‘lov jami va Qaytimi aniq');

    stage = 'Buyurtma summasini yaxlitlash';
    const rounded = await request('/orders', {
        orderType: OrderType.DINE_IN, tableId: table.id,
        items: [{ menuItemId: menus.fractional.id, quantity: '0.333333' }]
    });
    assert.equal(rounded.status, 201);
    assert.equal(rounded.body.data.totalAmount, '0.01');
    track('order', rounded.body.data);
    const roundedOrder = await tx.order.findUnique({ where: { id: rounded.body.data.id }, include: { items: true } });
    assert(roundedOrder.items[0].totalPrice.equals('0.01'));
    assert(roundedOrder.totalAmount.equals(roundedOrder.items[0].totalPrice));
    const roundedRows = [{ method: 'ELEKTRON', amount: '0.01' }];
    const roundedPayment = await request('/payments', payment(roundedOrder, roundedRows));
    assert.equal(roundedPayment.status, 200);
    await assertSettlement(roundedOrder, roundedRows, OrderStatus.TOLANDI);
    checks.push('Miqdorli taom summasi ikki kasrga yaxlitlanib to‘lanadi');
    assert.equal(suppressedRouteErrors, 0);
}

async function main() {
    // Marshrut xatolarida ulanish tafsilotlari yoki maxfiy qiymatlar chiqarilmaydi.
    console.error = (...args) => {
        suppressedRouteErrors++;
        const error = args.find(value => value instanceof Error);
        routeErrorCode = /^P\d{4}$/.test(error?.code || '') ? error.code : error?.name || '';
    };
    try {
        const app = express();
        app.use(express.json());
        app.use('/api/cashier', require(path.join(root, 'src/routes/cashier.routes.ts')).default);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        origin = `http://127.0.0.1:${server.address().port}`;
        try {
            await client.$transaction(async tx => {
                try { await runChecks(tx); }
                catch (error) { failure = error; }
                finally {
                    rollbackRequested = true;
                    throw rollback;
                }
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 240000, maxWait: 15000 });
            failure ||= new Error('VERIFY_ROLLBACK_MISSING');
        } catch (error) {
            if (error !== rollback) failure ||= error;
        }
        txClient = null;
        const failedStage = stage;
        stage = 'Tranzaksiya bekor qilinganini tekshirish';
        assert(rollbackRequested);
        // Faqat ushbu tekshiruv yaratgan identifikatorlar tekshiriladi.
        await Promise.all([...fixtures].map(async ([model, ids]) => {
            assert.equal(await client[model].count({ where: { id: { in: [...ids] } } }), 0);
        }));
        if (failure) {
            originalConsoleError(`Kassir bazasi tekshiruvi bajarilmadi: ${failedStage}. Sinov yozuvlari bekor qilindi.`);
            originalConsoleError(`Xato turi: ${failure.name}${/^P\d{4}$/.test(failure.code || '') ? ` (${failure.code})` : ''}.`);
            if (failure.name === 'AssertionError') {
                const safe = value => ['boolean', 'number'].includes(typeof value) ||
                    (typeof value === 'string' && value.length <= 80 && /^[A-Za-z0-9_ .-]+$/.test(value));
                if (safe(failure.actual) && safe(failure.expected)) {
                    originalConsoleError(`Kutilgan qiymat: ${failure.expected}; olingan qiymat: ${failure.actual}.`);
                }
            }
            if (routeErrorCode) originalConsoleError(`Marshrut xatosi turi: ${routeErrorCode}.`);
            process.exitCode = 1;
        } else {
            for (const check of checks) console.log(`✓ ${check}`);
            console.log(`Haqiqiy bazada ${checks.length} ta tekshiruv o‘tdi. Barcha sinov yozuvlari bekor qilindi va bazada yo‘qligi tekshirildi.`);
        }
    } catch (_error) {
        originalConsoleError(`Kassir bazasi tekshiruvi bajarilmadi: ${stage}.`);
        process.exitCode = 1;
    } finally {
        console.error = originalConsoleError;
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        await client.$disconnect();
    }
}

main().catch(() => {
    originalConsoleError('Kassir bazasi tekshiruvi yakunlanmadi.');
    process.exitCode = 1;
});
