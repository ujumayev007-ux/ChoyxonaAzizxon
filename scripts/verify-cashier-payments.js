/*
 * To‘lov oqimining regressiya tekshiruvi.
 * Ishga tushirish: node scripts/verify-cashier-payments.js
 * Haqiqiy Express marshruti va Prisma.Decimal ishlatiladi; ma’lumotlar bazasi,
 * autentifikatsiya, ombor va tashqi xabarlar faqat xotirada taqlid qilinadi.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const express = require('express');
const { Prisma, OrderStatus, OrderType, OrderSource, RoleType } = require('@prisma/client');

require('ts-node/register/transpile-only');

const root = path.resolve(__dirname, '..');
const decimal = value => new Prisma.Decimal(value);
const user = { id: 'cashier-1', fullName: 'Kassir', role: RoleType.CASHIER };
const events = [];
let state;
let transactionTail = Promise.resolve();
let lockCount = 0;
let stockFailure = false;

function copy(value) {
    if (Prisma.Decimal.isDecimal(value)) return decimal(value);
    if (value instanceof Date) return new Date(value);
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]));
    }
    return value;
}

function project(value, select) {
    if (!select || value == null) return copy(value);
    if (Array.isArray(value)) return value.map(entry => project(entry, select));
    const result = {};
    for (const [key, selection] of Object.entries(select)) {
        if (!selection) continue;
        result[key] = selection === true ? copy(value[key]) : project(value[key], selection.select);
    }
    return result;
}

function matches(value, where) {
    if (!where) return true;
    return Object.entries(where).every(([key, wanted]) => {
        if (key === 'AND') return wanted.every(filter => matches(value, filter));
        if (key === 'OR') return wanted.some(filter => matches(value, filter));
        if (key === 'NOT') return !matches(value, wanted);
        const actual = value?.[key];
        if (wanted === null || typeof wanted !== 'object' || wanted instanceof Date) return actual === wanted;
        if ('in' in wanted) return wanted.in.includes(actual);
        if ('not' in wanted) return actual !== wanted.not;
        if ('contains' in wanted) {
            const text = String(actual || '');
            return wanted.mode === 'insensitive'
                ? text.toLowerCase().includes(String(wanted.contains).toLowerCase())
                : text.includes(wanted.contains);
        }
        for (const [operator, expected] of Object.entries(wanted)) {
            if (operator === 'gt' && !(actual > expected)) return false;
            if (operator === 'gte' && !(actual >= expected)) return false;
            if (operator === 'lt' && !(actual < expected)) return false;
            if (operator === 'lte' && !(actual <= expected)) return false;
        }
        if (['gt', 'gte', 'lt', 'lte'].some(operator => operator in wanted)) return true;
        if ('is' in wanted) return matches(actual, wanted.is);
        return matches(actual, wanted);
    });
}

function uniqueError() {
    return new Prisma.PrismaClientKnownRequestError('Takroriy identifikator', {
        code: 'P2002', clientVersion: '5.22.0'
    });
}

function viewOrder(order) {
    return {
        ...order,
        payments: state.payment.filter(row => row.orderId === order.id),
        debt: state.customerDebt.find(row => row.orderId === order.id) || null,
        refunds: state.refund.filter(row => row.orderId === order.id)
    };
}

function model(name) {
    const entries = () => name === 'order' ? state.order.map(viewOrder) : state[name];
    return {
        async findUnique({ where, select } = {}) {
            return project(entries().find(row => matches(row, where)) || null, select);
        },
        async findFirst(options = {}) { return this.findUnique(options); },
        async findMany({ where, select, take, orderBy, include } = {}) {
            let rows = entries().filter(row => matches(row, where));
            if (orderBy) {
                const [key, direction] = Object.entries(orderBy)[0];
                rows.sort((left, right) => (left[key] > right[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1));
            }
            if (take) rows = rows.slice(0, take);
            if (include && name === 'payment') rows = rows.map(row => ({
                ...row, cashier: user, order: state.order.find(order => order.id === row.orderId)
            }));
            return rows.map(row => project(row, select));
        },
        async create({ data, select }) {
            if ((name === 'payment' && data.idempotencyKey && state[name].some(row => row.idempotencyKey === data.idempotencyKey)) ||
                (name === 'idempotencyRecord' && state[name].some(row => row.key === data.key))) throw uniqueError();
            const row = { id: `${name}-${state[name].length + 1}`, createdAt: new Date(), ...copy(data) };
            if (name === 'payment') row.changeAmount ||= decimal(0);
            if (name === 'refund' && data.items?.create) {
                row.items = data.items.create.map(item => {
                    const refundItem = { id: `refundItem-${state.refundItem.length + 1}`, refundId: row.id, ...copy(item) };
                    state.refundItem.push(refundItem);
                    return copy(refundItem);
                });
            }
            state[name].push(row);
            return project(row, select);
        },
        async update({ where, data, select }) {
            const row = state[name].find(entry => matches(entry, where));
            if (!row) throw new Error(`${name}: yozuv topilmadi`);
            const { statusHistory, ...changes } = data;
            Object.assign(row, copy(changes));
            if (statusHistory?.create) state.orderStatusHistory.push({ orderId: row.id, ...copy(statusHistory.create) });
            return project(name === 'order' ? viewOrder(row) : row, select);
        },
        async updateMany({ where, data }) {
            const rows = state[name].filter(row => matches(row, where));
            for (const row of rows) Object.assign(row, copy(data));
            return { count: rows.length };
        },
        async count({ where } = {}) { return entries().filter(row => matches(row, where)).length; },
        async aggregate({ where, _sum, _count } = {}) {
            const rows = entries().filter(row => matches(row, where));
            return {
                _sum: Object.fromEntries(Object.keys(_sum || {}).map(key => [key,
                    rows.reduce((sum, row) => sum.plus(row[key] || 0), decimal(0))])),
                _count: Object.fromEntries(Object.keys(_count || {}).map(key => [key, rows.length]))
            };
        },
        async groupBy({ by, where, _sum, _count }) {
            const rows = entries().filter(row => matches(row, where));
            const values = [...new Set(rows.map(row => row[by[0]]))];
            return values.map(value => {
                const group = rows.filter(row => row[by[0]] === value);
                return {
                    [by[0]]: value,
                    _sum: Object.fromEntries(Object.keys(_sum || {}).map(key => [key,
                        group.reduce((sum, row) => sum.plus(row[key] || 0), decimal(0))])),
                    _count: Object.fromEntries(Object.keys(_count || {}).map(key => [key, group.length]))
                };
            });
        }
    };
}

const models = ['order', 'payment', 'customerDebt', 'customer', 'receipt', 'printJob', 'auditLog',
    'idempotencyRecord', 'cashMovement', 'cashSession', 'orderStatusHistory', 'table', 'expense',
    'refund', 'refundItem', 'takeawayVerification'];
const prisma = Object.fromEntries(models.map(name => [name, model(name)]));
prisma.$queryRaw = async (strings, ...values) => {
    assert.match(strings.join('?'), /FOR UPDATE/i, 'To‘lov buyurtmani bloklashi kerak');
    lockCount++;
    return state.order.filter(order => order.id === values[0]).map(order => ({ id: order.id }));
};
prisma.$transaction = async (operation, options) => {
    assert.equal(options?.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    const previous = transactionTail;
    let release;
    transactionTail = new Promise(resolve => { release = resolve; });
    await previous;
    const saved = copy(state);
    try { return await operation(prisma); }
    catch (error) { state = saved; throw error; }
    finally { release(); }
};

function stub(relative, exports) {
    const filename = require.resolve(path.join(root, 'src', relative));
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const next = (_req, _res, proceed) => proceed();
stub('utils/db.ts', { prisma });
stub('middleware/auth.ts', {
    authenticateToken(req, _res, proceed) { req.user = user; proceed(); },
    requireCashierAccess: next, requireRole: () => next,
    clearTerminalAdminCookie() {}, setTerminalAdminCookie() {}
});
stub('socket.ts', { emitSocketEvent(event, payload) { events.push({ event, payload: copy(payload) }); } });
stub('utils/order-packaging.ts', { async deductPackaging() {} });
stub('utils/order-recipes.ts', {
    async deductOrderRecipes() {
        if (stockFailure) throw new Error('RECIPE_STOCK_SHORT:Guruch');
        return ['inventory-1'];
    }
});
stub('utils/telegram.ts', { formatTelegramMessage() { return ''; }, async sendToActiveSubscribers() {} });

const router = require(path.join(root, 'src/routes/cashier.routes.ts')).default;
const app = express();
app.use(express.json());
app.use('/api/cashier', router);
const server = app.listen(0, '127.0.0.1');
let origin;
let keyCounter = 0;

function reset(total = '100.00', overrides = {}) {
    state = Object.fromEntries(models.map(name => [name, []]));
    state.order.push({
        id: 'waiter-order', orderNumber: '20261010-001', source: OrderSource.WAITER,
        orderType: OrderType.DINE_IN, status: OrderStatus.TOLOV_KUTILMOQDA,
        tableId: 'table-1', table: { id: 'table-1', number: '1', roomId: 'room-1', room: { id: 'room-1', name: 'Zal' } },
        waiter: { id: 'waiter-1', fullName: 'Ofitsiant' }, waiterId: 'waiter-1',
        customerId: null, customer: null, customerName: null, customerPhone: null,
        processingById: null, processingAt: null, discount: decimal(0), subtotal: decimal(total),
        totalAmount: decimal(total), paidAt: null, createdAt: new Date('2026-10-10T05:00:00Z'),
        items: [{ id: 'item-1', menuItemId: 'menu-1', quantity: decimal(1), unitPrice: decimal(total),
            totalPrice: decimal(total), menuItem: { id: 'menu-1', name: 'Osh', unit: 'dona' } }],
        packagingItems: [], ...overrides
    });
    state.table.push({ id: 'table-1', roomId: 'room-1', number: '1', status: 'BAND' });
    events.length = 0;
    lockCount = 0;
    stockFailure = false;
}

async function request(route, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${origin}/api/cashier${route}`, {
        method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
}

function payment(rows, extras = {}) {
    return {
        orderId: 'waiter-order', payments: rows, expectedRemaining: state.order[0].totalAmount.toFixed(2),
        idempotencyKey: `cashier_verify_${++keyCounter}`, ...extras
    };
}

function assertNoPayments(expectNoEvents = true) {
    assert.equal(state.payment.length, 0);
    assert.equal(state.receipt.length, 0);
    assert.equal(state.auditLog.length, 0);
    assert.equal(state.idempotencyRecord.length, 0);
    if (expectNoEvents) assert.equal(events.length, 0);
    else assert(!events.some(entry => ['paymentReceived', 'orderUpdate', 'order_status_updated'].includes(entry.event)));
}

const checks = [];
function check(name, run) { checks.push({ name, run }); }

check('Ofitsiant buyurtmasi kassa ro‘yxati va bosh sahifada to‘g‘ri ko‘rinadi', async () => {
    reset('45000.50', { status: OrderStatus.YANGI });
    const orders = await request('/orders');
    assert.equal(orders.status, 200);
    assert.equal(orders.body.data.length, 1);
    assert.equal(orders.body.data[0].source, OrderSource.WAITER);
    assert.equal(orders.body.data[0].status, OrderStatus.YANGI);
    assert.equal(orders.body.data[0].totalAmount, '45000.5');
    assert.deepEqual(orders.body.data[0].payments, []);
    const dashboard = await request('/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.data.activeOrders[0].id, 'waiter-order');
    assert.equal(dashboard.body.data.activeOrders[0].totalAmount, '45000.5');
});

for (const method of ['NAQD', 'PLASTIK', 'ELEKTRON']) {
    check(`${method}: to‘lov saqlanadi, buyurtma yopiladi va panellarga xabar boradi`, async () => {
        reset('100.25');
        const result = await request('/payments', payment([{ method, amount: '100.25',
            ...(method === 'NAQD' ? { customerGiven: '150.50' } : {}) }]));
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.success, true);
        assert.equal(state.payment.length, 1);
        assert.equal(state.payment[0].method, method);
        assert.equal(state.payment[0].amount.toString(), '100.25');
        assert.equal(state.order[0].status, OrderStatus.TOLANDI);
        assert(state.order[0].paidAt instanceof Date);
        assert.equal(state.receipt.length, 1);
        assert.equal(state.printJob.length, 1);
        assert.equal(state.auditLog[0].action, 'PAYMENT_RECEIVED');
        assert.equal(state.idempotencyRecord.length, 1);
        assert.equal(result.body.data.remaining, '0');
        assert.equal(state.cashMovement.length, method === 'NAQD' ? 1 : 0);
        if (method === 'NAQD') {
            assert.equal(state.payment[0].changeAmount.toString(), '50.25');
            assert.equal(result.body.data.change, '50.25');
            assert.equal(state.cashMovement[0].amount.toString(), '100.25');
        }
        for (const event of ['paymentReceived', 'orderUpdate', 'order_status_updated', 'table_status_updated']) {
            assert(events.some(entry => entry.event === event), `${event}: Socket.io xabari yo‘q`);
        }
        const update = events.find(entry => entry.event === 'order_status_updated').payload;
        assert.equal(update.orderId, 'waiter-order');
        assert.equal(update.tableId, 'table-1');
        assert.equal(update.roomId, 'room-1');
        assert.equal(update.remaining, '0');
        assert.equal(update.totalAmount, '100.25');
        assert(events.some(entry => entry.event === 'inventory_updated'));
        assert(lockCount > 0);
        const history = await request('/payments');
        assert.equal(history.body.data[0].amount, '100.25');
        const exact = await request('/orders?id=waiter-order');
        assert.equal(exact.body.data[0].status, OrderStatus.TOLANDI);
        assert.equal(exact.body.data[0].payments[0].amount, '100.25');
    });
}

check('Kasrli aralash to‘lovlarda jami va Qaytim aniq', async () => {
    reset('0.30');
    const result = await request('/payments', payment([
        { method: 'NAQD', amount: '0.10', customerGiven: '1.00' },
        { method: 'PLASTIK', amount: '0.10' }, { method: 'ELEKTRON', amount: '0.10' }
    ]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(state.order[0].status, OrderStatus.TOLANDI);
    assert.equal(result.body.data.change, '0.9');
    assert.equal(state.payment.reduce((sum, row) => sum.plus(row.amount), decimal(0)).toString(), '0.3');
});

check('Qisman to‘lov va qolgan summani to‘lash', async () => {
    reset('100.25');
    const first = await request('/payments', payment([{ method: 'PLASTIK', amount: '40.10' }]));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(state.order[0].status, OrderStatus.QISMAN_TOLANDI);
    assert.equal(state.order[0].paidAt, null);
    assert.equal(first.body.data.remaining, '60.15');
    const list = await request('/orders');
    const paid = list.body.data[0].payments.reduce((sum, row) => sum.plus(row.amount), decimal(0));
    assert.equal(decimal(list.body.data[0].totalAmount).minus(paid).toString(), '60.15');
    const second = await request('/payments', payment([{ method: 'ELEKTRON', amount: '60.15' }], { expectedRemaining: '60.15' }));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(state.order[0].status, OrderStatus.TOLANDI);
    assert.equal(state.payment.length, 2);
});

check('Bir kalitdagi takroriy so‘rov qayta pul yozmaydi', async () => {
    reset();
    const body = payment([{ method: 'NAQD', amount: '100', customerGiven: '120' }]);
    const first = await request('/payments', body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const eventCount = events.length;
    const again = await request('/payments', body);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true);
    assert.deepEqual(again.body.data, first.body.data);
    assert.equal(state.payment.length, 1);
    assert.equal(state.receipt.length, 1);
    assert.equal(events.length, eventCount);
    const changed = await request('/payments', { ...body, payments: [{ method: 'PLASTIK', amount: '100' }] });
    assert.equal(changed.status, 409);
    assert.equal(state.payment.length, 1);
});

check('Bir vaqtdagi bir xil so‘rovlar bir marta saqlanadi', async () => {
    reset();
    const body = payment([{ method: 'NAQD', amount: '100' }]);
    const results = await Promise.all([request('/payments', body), request('/payments', body)]);
    assert.deepEqual(results.map(result => result.status), [200, 200], JSON.stringify(results));
    assert.equal(results.filter(result => result.body.duplicate).length, 1);
    assert.equal(state.payment.length, 1);
    assert.equal(state.receipt.length, 1);
});

check('Eski Qoldiq bilan takroriy yoki parallel to‘lov rad etiladi', async () => {
    reset();
    const bodies = [payment([{ method: 'PLASTIK', amount: '60' }]), payment([{ method: 'ELEKTRON', amount: '60' }])];
    const results = await Promise.all(bodies.map(body => request('/payments', body)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
    assert.equal(state.payment.length, 1);
    assert.equal(state.payment[0].amount.toString(), '60');
});

check('O‘zgargan buyurtma jami mijozning eski summasi bilan to‘lanmaydi', async () => {
    reset('125');
    const result = await request('/payments', payment([{ method: 'NAQD', amount: '100' }], { expectedRemaining: '100.00' }));
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assertNoPayments();
});

const invalidRows = [
    ['manfiy summa', [{ method: 'NAQD', amount: '-1' }]],
    ['nol summa', [{ method: 'NAQD', amount: '0' }]],
    ['ortiqcha karta', [{ method: 'PLASTIK', amount: '100.01' }]],
    ['ortiqcha elektron', [{ method: 'ELEKTRON', amount: '100.01' }]],
    ['manfiy mijoz bergan pul', [{ method: 'NAQD', amount: '100', customerGiven: '-1' }]],
    ['noto‘g‘ri mijoz bergan pul', [{ method: 'NAQD', amount: '100', customerGiven: 'abc' }]],
    ['null mijoz bergan pul', [{ method: 'NAQD', amount: '100', customerGiven: null }]],
    ['yetarli bo‘lmagan naqd pul', [{ method: 'NAQD', amount: '100', customerGiven: '99.99' }]],
    ['noto‘g‘ri usul', [{ method: 'UNKNOWN', amount: '100' }]],
    ['noto‘g‘ri kasr aniqligi', [{ method: 'NAQD', amount: '99.999' }]],
    ['bo‘sh to‘lov qatori', [null]],
    ['son ko‘rinishidagi to‘lov qatori', [42]]
];
for (const [name, rows] of invalidRows) check(`${name}: ma’lumotlar saqlanmaydi`, async () => {
    reset();
    const result = await request('/payments', payment(rows));
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assertNoPayments();
});

check('Mijoz bergan pul bo‘lmasa naqd summa olinadi', async () => {
    reset();
    const result = await request('/payments', payment([{ method: 'NAQD', amount: '100' }]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(state.payment[0].customerGiven.toString(), '100');
    assert.equal(state.payment[0].changeAmount.toString(), '0');
});

check('Naqd qatorlar Qaytimi alohida saqlanadi', async () => {
    reset();
    const result = await request('/payments', payment([
        { method: 'NAQD', amount: '40', customerGiven: '50' },
        { method: 'NAQD', amount: '60', customerGiven: '100' }
    ]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(state.payment.map(row => row.changeAmount.toString()), ['10', '40']);
    assert.equal(result.body.data.change, '50');
});

check('Bekor qilingan va to‘langan buyurtmalarda yangi pul qabul qilinmaydi', async () => {
    for (const status of [OrderStatus.BEKOR_QILINDI, OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI, OrderStatus.QAYTARILDI]) {
        reset('100', { status });
        const result = await request('/payments', payment([{ method: 'NAQD', amount: '100' }]));
        assert.equal(result.status, 409, JSON.stringify(result.body));
        assertNoPayments();
    }
});

check('Ombor xatosida butun to‘lov tranzaksiyasi qaytariladi', async () => {
    reset();
    stockFailure = true;
    const result = await request('/payments', payment([{ method: 'NAQD', amount: '100' }]));
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assertNoPayments();
    assert.equal(state.cashMovement.length, 0);
    assert.equal(state.order[0].status, OrderStatus.TOLOV_KUTILMOQDA);
});

check('Oldin undirilgan qarz buyurtmaning to‘langan holatiga to‘sqinlik qilmaydi', async () => {
    reset('100', { customerId: 'customer-1', status: OrderStatus.QISMAN_TOLANDI });
    state.payment.push({ id: 'old-payment', orderId: 'waiter-order', amount: decimal(30), method: 'PLASTIK' });
    state.customerDebt.push({ id: 'debt-1', orderId: 'waiter-order', customerId: 'customer-1',
        amount: decimal(20), remaining: decimal(0) });
    const result = await request('/payments', payment([{ method: 'ELEKTRON', amount: '50' }], { expectedRemaining: '50.00' }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(state.order[0].status, OrderStatus.TOLANDI);
    assert.equal(result.body.data.remaining, '0');
    assert.equal(state.customerDebt[0].amount.toString(), '20');
});

function paidFractionalOrder(total, quantity) {
    reset(total, { status: OrderStatus.TOLANDI, paidAt: new Date(), items: [{
        id: 'item-1', menuItemId: 'menu-1', quantity: decimal(quantity), unitPrice: decimal(1),
        totalPrice: decimal(total), menuItem: { id: 'menu-1', name: 'Osh', unit: 'kg' }
    }] });
    state.payment.push({ id: 'old-payment', orderId: 'waiter-order', amount: decimal(total), method: 'NAQD' });
}

function refund(quantity) {
    return {
        orderId: 'waiter-order', method: 'NAQD', reason: 'Taom qaytarildi',
        items: [{ orderItemId: 'item-1', quantity }], idempotencyKey: `cashier_refund_${++keyCounter}`
    };
}

for (const [total, quantity] of [['0.33', '0.333333'], ['0.67', '0.666666']]) {
    check(`Yaxlitlangan ${total} summali taom to‘liq qaytariladi`, async () => {
        paidFractionalOrder(total, quantity);
        const result = await request('/refunds', refund(quantity));
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.data.amount, total);
        assert.equal(state.refund[0].amount.toString(), total);
        assert.equal(state.refundItem[0].amount.toString(), total);
        assert.equal(state.order[0].status, OrderStatus.QAYTARILDI);
        assert.equal(state.cashMovement[0].amount.toString(), `-${total}`);
    });
}

check('Yaxlitlangan summaning qisman qaytimlari asl to‘lovga aniq teng', async () => {
    paidFractionalOrder('0.67', '0.666666');
    const first = await request('/refunds', refund('0.333333'));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.amount, '0.34');
    assert.equal(state.order[0].status, OrderStatus.TOLANDI);
    const second = await request('/refunds', refund('0.333333'));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.amount, '0.33');
    assert.equal(state.refund.reduce((sum, row) => sum.plus(row.amount), decimal(0)).toString(), '0.67');
    assert.equal(state.order[0].status, OrderStatus.QAYTARILDI);
    assert.deepEqual(state.refundItem.map(row => row.amount.toString()), ['0.34', '0.33']);
    const third = await request('/refunds', refund('0.000001'));
    assert.equal(third.status, 409);
    assert.equal(state.refund.length, 2);
});

// Kassa sahifasidagi haqiqiy hisoblash va yuborish funksiyalarini ishlatish.
// DOM faqat to‘lov formasining zarur maydonlari darajasida taqlid qilinadi.
const cashierHtml = fs.readFileSync(path.join(root, 'public/cashier/index.html'), 'utf8');
const helpersStart = cashierHtml.indexOf('const moneyCents =');
const helperEnd = cashierHtml.indexOf(';', cashierHtml.indexOf('const closedPaymentStatuses =')) + 1;
const paymentStart = cashierHtml.indexOf('function paymentAmounts(');
const paymentEnd = cashierHtml.indexOf('function openDebtPayment(');
assert(helpersStart >= 0 && helperEnd > helpersStart && paymentStart >= 0 && paymentEnd > paymentStart,
    'Kassa to‘lov funksiyalari topilmadi');
const frontendSource = cashierHtml.slice(helpersStart, helperEnd) + '\n' + cashierHtml.slice(paymentStart, paymentEnd);

function frontend(values = {}, options = {}) {
    const classes = new Set(['hidden']);
    const error = { textContent: '', classList: { add: key => classes.add(key), remove: key => classes.delete(key) } };
    const button = { disabled: false, textContent: '', style: {} };
    const fields = Object.fromEntries(Object.entries({ cash: '', given: '', card: '0', electronic: '0',
        debt: '0', customerId: '', ...values }).map(([name, value]) => [name, { name, value, readOnly: false }]));
    const nodes = {
        '#payment-error': error, '#confirm-payment-btn': button, '#payment-due': { textContent: '' },
        '#payment-sum': { textContent: '' }, '[data-action="unlock-order"]': { disabled: false }
    };
    const form = {
        elements: fields, querySelector: selector => nodes[selector] || null,
        querySelectorAll: selector => selector === 'input' ? Object.values(fields) : [],
        addEventListener() {}
    };
    const calls = [];
    const notices = [];
    let html = '';
    let active = false;
    let ambiguous = options.ambiguous;
    const context = {
        console, state: { user, tab: 'orders', paymentSession: null, currentOrder: null },
        FormData: class {
            constructor(target) { this.target = target; }
            entries() { return Object.entries(this.target.elements).map(([name, field]) => [name, field.value]); }
        },
        money: value => `${value} so‘m`, esc: value => String(value ?? ''), newKey: () => `cashier_frontend_${++keyCounter}`,
        toast: message => notices.push(message), async switchTab() {},
        document: { getElementById: id => id === 'payment-form' && active ? form : null },
        openModal(_title, body) {
            html = body;
            assert.match(body, /<button type="submit" id="confirm-payment-btn"/);
            active = true;
        },
        closeModal() { context.state.paymentSession = null; context.state.currentOrder = null; active = false; return true; },
        async api(route, requestOptions = {}) {
            calls.push({ route, options: copy(requestOptions) });
            if (options.beforeRequest) await options.beforeRequest(route, requestOptions);
            const result = await request(route.replace('/api/cashier', ''),
                requestOptions.body ? JSON.parse(requestOptions.body) : undefined, requestOptions.method || 'GET');
            if (result.status >= 400) throw Object.assign(new Error(result.body.message), { status: result.status });
            if (route === '/api/cashier/payments' && ambiguous) {
                ambiguous = false;
                throw new Error('Tarmoq uzildi');
            }
            return result.body;
        }
    };
    vm.createContext(context);
    vm.runInContext(frontendSource, context, { filename: 'public/cashier/index.html:payment' });
    return { context, form, button, error, fields, nodes, calls, notices, get html() { return html; },
        async open() { await context.openPayment('waiter-order'); assert(context.state.paymentSession); },
        async submit() { await context.submitPayment({ preventDefault() {}, currentTarget: form }); }
    };
}

for (const [label, values, expected] of [
    ['naqd', { cash: '100.25', given: '150.50' }, ['NAQD']],
    ['karta', { card: '100.25' }, ['PLASTIK']],
    ['elektron', { electronic: '100.25' }, ['ELEKTRON']],
    ['aralash', { cash: '40.10', given: '50.50', card: '30.05', electronic: '30.10' }, ['NAQD', 'PLASTIK', 'ELEKTRON']]
]) check(`Kassa formasi: ${label} to‘lov API va bazagacha yetib boradi`, async () => {
    reset('100.25');
    const ui = frontend(values);
    await ui.open();
    assert.equal(ui.button.disabled, false);
    assert.match(ui.nodes['#payment-sum'].textContent, /Qaytim: .*Qoldiq: 0 so‘m/);
    await ui.submit();
    const sent = ui.calls.find(call => call.route === '/api/cashier/payments');
    assert(sent, 'Forma to‘lov so‘rovini yubormadi');
    const body = JSON.parse(sent.options.body);
    assert.equal(body.expectedRemaining, '100.25');
    assert.deepEqual(body.payments.map(row => row.method), expected);
    assert.equal(state.order[0].status, OrderStatus.TOLANDI);
    assert.equal(ui.context.state.paymentSession, null);
    if (values.given) assert.equal(state.payment[0].customerGiven.toString(), decimal(values.given).toString());
});

check('Kassa formasi: Qoldiq kamayadi va yetarli bo‘lmagan to‘lov yuborilmaydi', async () => {
    reset();
    const ui = frontend({ cash: '40' });
    await ui.open();
    assert.match(ui.nodes['#payment-sum'].textContent, /Qoldiq: 60 so‘m/);
    assert.equal(ui.button.disabled, true);
    await ui.submit();
    assert.equal(ui.calls.filter(call => call.route === '/api/cashier/payments').length, 0);
    assertNoPayments(false);
});

check('Kassa formasi: ortiqcha karta summasi qisqartirilmaydi va yuborilmaydi', async () => {
    reset();
    const ui = frontend({ card: '150' });
    await ui.open();
    assert.equal(ui.button.disabled, true);
    await ui.submit();
    assert.match(ui.error.textContent, /qoldiqdan oshmasligi/);
    assert.equal(ui.calls.filter(call => call.route === '/api/cashier/payments').length, 0);
    assertNoPayments(false);
});

check('Kassa formasi: ortiqcha naqd pul Qaytim sifatida qaytariladi', async () => {
    reset();
    const ui = frontend({ cash: '150', given: '150' });
    await ui.open();
    assert.match(ui.nodes['#payment-sum'].textContent, /Qaytim: 50 so‘m/);
    await ui.submit();
    assert.equal(state.payment[0].amount.toString(), '100');
    assert.equal(state.payment[0].changeAmount.toString(), '50');
});

check('Kassa formasi: ketma-ket bosish faqat bitta so‘rov yuboradi', async () => {
    reset();
    const ui = frontend({ card: '100' });
    await ui.open();
    await Promise.all([ui.submit(), ui.submit()]);
    assert.equal(ui.calls.filter(call => call.route === '/api/cashier/payments').length, 1);
    assert.equal(state.payment.length, 1);
});

check('Kassa formasi: tarmoq uzilganda bir xil kalit va summa qayta tekshiriladi', async () => {
    reset();
    const ui = frontend({ cash: '100', given: '120' }, { ambiguous: true });
    await ui.open();
    await ui.submit();
    assert.equal(state.payment.length, 1);
    assert(ui.context.state.paymentSession.request);
    assert.equal(ui.button.disabled, false);
    assert.match(ui.button.textContent, /qayta tekshirish/);
    ui.fields.cash.value = '200';
    await ui.submit();
    const requests = ui.calls.filter(call => call.route === '/api/cashier/payments');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.body, requests[1].options.body);
    assert.equal(state.payment.length, 1);
    assert.equal(state.receipt.length, 1);
    assert.equal(ui.context.state.paymentSession, null);
});

check('Kassa formasi: tasdiqlash oldidan o‘zgargan jami qayta tekshiriladi', async () => {
    reset();
    const ui = frontend({ card: '100' });
    await ui.open();
    state.order[0].totalAmount = decimal(125);
    state.order[0].subtotal = decimal(125);
    await ui.submit();
    assert.equal(ui.calls.filter(call => call.route === '/api/cashier/payments').length, 0);
    assert.match(ui.error.textContent, /o‘zgardi/);
    assert.equal(ui.context.state.paymentSession.due, 12500);
    assert.equal(ui.button.disabled, true);
    assertNoPayments(false);
    // Oxirgi avtomatik yangilash tugashini kutish.
    await new Promise(resolve => setImmediate(resolve));
});

(async () => {
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    let failed = 0;
    try {
        for (const { name, run } of checks) {
            try { await run(); console.log(`✓ ${name}`); }
            catch (error) { failed++; console.error(`✗ ${name}\n  ${error.message}`); }
        }
        console.log(`${checks.length - failed}/${checks.length} tekshiruv o‘tdi.`);
        if (failed) process.exitCode = 1;
    } finally {
        server.close();
        server.closeAllConnections();
        await once(server, 'close');
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
