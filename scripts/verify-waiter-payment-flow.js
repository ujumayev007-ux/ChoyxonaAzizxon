/* Execute the real waiter order and table-payment handlers against an isolated
 * in-memory Prisma double. No database connection, HTTP listener, or bot starts.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const client = require('@prisma/client');
const { Prisma, OrderStatus, PaymentMethod } = client;

const projectRoot = path.resolve(__dirname, '..');
const decimal = value => new Prisma.Decimal(value);
const waiter = { id: 'waiter-1', role: 'WAITER', fullName: 'Ofitsiant', username: 'ofitsiant' };
const cashier = { id: 'cashier-1', role: 'CASHIER', fullName: 'Kassir' };

function copy(value) {
    if (value instanceof Prisma.Decimal) return decimal(value);
    if (value instanceof Date) return new Date(value);
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, copy(item)]));
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
    return value;
}

function knownError(code) {
    return new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.0.0' });
}

function fixture(options = {}) {
    const table = { id: 'table-1', number: 1, roomId: 'room-1', room: { id: 'room-1', name: 'Asosiy xona' } };
    const menu = [
        { id: 'food-1', name: 'Osh', unit: 'kg', sellingPrice: decimal('123.45') },
        { id: 'food-2', name: 'Choy', unit: 'dona', sellingPrice: decimal('10.05') }
    ];
    const orders = new Map();
    if (options.order !== false) {
        const order = {
            id: 'order-1', orderNumber: 'TEST-1', tableId: table.id, table, waiter,
            waiterId: waiter.id, status: options.status || OrderStatus.YANGI, source: 'WAITER',
            orderType: 'DINE_IN', totalAmount: decimal(options.total || '100'), subtotal: decimal(options.total || '100'),
            processingById: options.processingById || null, paidAt: null, createdAt: new Date(),
            payments: (options.paid || []).map((amount, index) => ({ id: `old-${index}`, amount: decimal(amount), method: PaymentMethod.NAQD })),
            debt: options.debt ? { amount: decimal(options.debt.amount), remaining: decimal(options.debt.remaining) } : null,
            items: [{ quantity: decimal(1), unitPrice: decimal(options.total || '100'), totalPrice: decimal(options.total || '100'), menuItem: menu[0] }]
        };
        orders.set(order.id, order);
    }
    return {
        table, menu, orders, payments: [], receipts: [], printJobs: [], audits: [], movements: [], history: [],
        idempotency: new Map(), packaging: [], recipes: [], queryLog: [], nextId: 1
    };
}

function makeDatabase(initial) {
    let state = initial;
    let transactionQueue = Promise.resolve();
    let beforeTransaction = null;
    const events = [];
    function models(getState) {
        return {
            user: { count: async () => 1 },
            table: { findFirst: async ({ where }) => where.id === getState().table.id ? copy(getState().table) : null },
            menuItem: { findMany: async ({ where }) => copy(getState().menu.filter(item => where.id.in.includes(item.id))) },
            order: {
                create: async ({ data }) => {
                    const current = getState();
                    const id = `created-${current.nextId++}`;
                    const order = {
                        ...copy(data), id, table: copy(current.table), waiter: copy(waiter), orderType: 'DINE_IN',
                        payments: [], debt: null, processingById: null, createdAt: new Date(),
                        items: data.items.create.map(item => ({ ...copy(item), menuItem: copy(current.menu.find(menu => menu.id === item.menuItemId)) }))
                    };
                    current.orders.set(id, order);
                    current.history.push({ orderId: id, ...copy(data.statusHistory.create) });
                    return copy(order);
                },
                findMany: async ({ where = {} }) => {
                    const current = getState();
                    current.queryLog.push('orders-read');
                    return copy([...current.orders.values()].filter(order =>
                        (!where.tableId || order.tableId === where.tableId) &&
                        (!where.status?.notIn || !where.status.notIn.includes(order.status))));
                },
                findUnique: async ({ where }) => copy(getState().orders.get(where.id) || null),
                update: async ({ where, data }) => {
                    const current = getState();
                    const order = current.orders.get(where.id);
                    assert.ok(order, 'Yangilanadigan buyurtma mavjud');
                    const { statusHistory, ...fields } = data;
                    Object.assign(order, copy(fields));
                    if (statusHistory) current.history.push({ orderId: order.id, ...copy(statusHistory.create) });
                    return copy(order);
                },
                updateMany: async ({ where, data }) => {
                    let count = 0;
                    for (const order of getState().orders.values()) {
                        if (Object.entries(where).every(([key, value]) => order[key] === value)) {
                            Object.assign(order, copy(data));
                            count++;
                        }
                    }
                    return { count };
                }
            },
            orderStatusHistory: { create: async ({ data }) => { getState().history.push(copy(data)); return copy(data); } },
            payment: {
                create: async ({ data }) => {
                    const current = getState();
                    if (current.payments.some(payment => payment.idempotencyKey === data.idempotencyKey)) throw knownError('P2002');
                    const payment = { id: `payment-${current.nextId++}`, ...copy(data) };
                    current.payments.push(payment);
                    current.orders.get(data.orderId).payments.push(payment);
                    return copy(payment);
                }
            },
            idempotencyRecord: {
                findUnique: async ({ where }) => copy(getState().idempotency.get(where.key) || null),
                create: async ({ data }) => {
                    if (getState().idempotency.has(data.key)) throw knownError('P2002');
                    getState().idempotency.set(data.key, copy(data));
                    return copy(data);
                }
            },
            receipt: { create: async ({ data }) => { const record = { id: `receipt-${getState().nextId++}`, ...copy(data) }; getState().receipts.push(record); return copy(record); } },
            printJob: { create: async ({ data }) => { getState().printJobs.push(copy(data)); return data; } },
            auditLog: { create: async ({ data }) => { getState().audits.push(copy(data)); return data; } },
            cashSession: { findFirst: async () => ({ id: 'session-1' }) },
            cashMovement: { create: async ({ data }) => { getState().movements.push(copy(data)); return data; } },
            $queryRaw: async (strings, ...values) => { getState().queryLog.push({ sql: strings.join('?'), values }); return []; },
            _state: getState
        };
    }
    const database = models(() => state);
    database.$transaction = (callback, options) => {
        if (options) assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
        const run = transactionQueue.then(async () => {
            if (beforeTransaction) {
                const change = beforeTransaction;
                beforeTransaction = null;
                change(state);
            }
            const staged = copy(state);
            const result = await callback(models(() => staged));
            state = staged;
            return result;
        });
        transactionQueue = run.catch(() => {});
        return run;
    };
    return { database, events, beforeNextTransaction: callback => { beforeTransaction = callback; }, get state() { return state; } };
}

function loadHandlers(harness) {
    const routes = new Map();
    const app = { use() {} };
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
        app[method] = (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers.at(-1));
    }
    const express = Object.assign(() => app, { json: () => () => {}, static: () => () => {} });
    const middleware = () => {};
    const auth = new Proxy({}, { get: (_target, key) => key === 'requireRole' ? () => middleware : middleware });
    const mocks = {
        express,
        http: { createServer: () => ({ listen() {} }) },
        'socket.io': { Server: class { on() {} } },
        cors: () => middleware,
        '@prisma/client': { ...client, PrismaClient: function PrismaClient() { return harness.database; } },
        './socket': { initSocket() {}, emitSocketEvent: (name, data) => harness.events.push({ name, data: copy(data) }) },
        './middleware/auth': auth,
        './utils/password': { hashPassword: async () => 'test', verifyPassword: async () => true },
        './utils/order-packaging': { deductPackaging: async (tx, orderId) => tx._state().packaging.push(orderId) },
        './utils/order-recipes': { deductOrderRecipes: async (tx, orderId) => { tx._state().recipes.push(orderId); return ['stock-1']; } }
    };
    const sourcePath = path.join(projectRoot, 'src', 'server.ts');
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText;
    const context = {
        exports: {}, __dirname: path.dirname(sourcePath), Buffer, URL, Error, Date,
        console: { log() {}, warn() {}, error() {} },
        process: { env: {}, cwd: () => projectRoot, once() {}, exit: code => { throw new Error(`Sinov serverini ishga tushirishda xatolik: ${code}`); } },
        require: name => {
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name.startsWith('./routes/')) return middleware;
            return require(name);
        }
    };
    vm.runInNewContext(compiled, context, { filename: sourcePath });
    return routes;
}

function setup(options) {
    const harness = makeDatabase(fixture(options));
    harness.routes = loadHandlers(harness);
    return harness;
}

async function invoke(harness, route, body, options = {}) {
    const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    const request = { body, params: options.params || { tableId: 'table-1' }, query: options.query || {}, user: options.user || cashier };
    const handler = harness.routes.get(route);
    assert.equal(typeof handler, 'function', `Haqiqiy so‘rov ishlovchisi topildi: ${route}`);
    await handler(request, response);
    return response;
}

const pay = (harness, paymentMethod, idempotencyKey = 'test-table-payment-0001', options) =>
    invoke(harness, 'POST /api/tables/:tableId/pay', { paymentMethod, idempotencyKey }, options);

function assertPaymentEvents(harness, status) {
    for (const name of ['paymentReceived', 'orderUpdate', 'order_status_updated']) {
        const event = harness.events.find(event => event.name === name);
        assert.ok(event, `${name} hodisasi saqlangandan keyin yuboriladi`);
        assert.equal(event.data.orderId, 'order-1');
        assert.equal(event.data.status, status);
        assert.equal(event.data.tableId, 'table-1');
        assert.equal(event.data.roomId, 'room-1');
    }
    assert.ok(harness.events.some(event => event.name === 'table_status_updated' && event.data.tableId === 'table-1'));
}

let checks = 0;
async function check(name, test) {
    await test();
    checks++;
    console.log(`O‘TDI: ${name}`);
}

async function main() {
    await check('Ofitsiant buyurtmasi bazadagi narxlar bilan hisoblanadi va kasr miqdorlar tiyingacha yaxlitlanadi', async () => {
        const harness = setup({ order: false });
        const response = await invoke(harness, 'POST /api/orders', {
            tableId: 'table-1', totalAmount: 1, subtotal: 1, source: 'CASHIER',
            items: [
                { productId: 'food-1', quantity: '0.333333', unitPrice: 1, totalPrice: 1 },
                { productId: 'food-2', quantity: 2, price: 1 }
            ]
        }, { user: waiter });
        assert.equal(response.code, 201);
        const order = response.body.data;
        assert.equal(order.source, 'WAITER');
        assert.equal(order.waiterId, waiter.id);
        assert.equal(order.status, OrderStatus.YANGI);
        assert.equal(order.items[0].unitPrice, '123.45');
        assert.equal(order.items[0].totalPrice, '41.15');
        assert.equal(order.items[1].totalPrice, '20.1');
        assert.equal(order.totalAmount, '61.25');
        assert.equal(order.subtotal, '61.25');
        const listed = await invoke(harness, 'GET /api/orders', null, { user: waiter, query: { active: 'true' } });
        assert.equal(listed.body[0].totalAmount, '61.25');
        assert.equal(listed.body[0].status, OrderStatus.YANGI);
        assert.ok(harness.events.some(event => event.name === 'orderUpdate' && event.data.orderId === order.id));
        const payment = await pay(harness, 'PLASTIK');
        assert.equal(payment.code, 200);
        assert.equal(harness.state.payments[0].orderId, order.id);
        assert.equal(harness.state.payments[0].amount.toString(), '61.25');
        assert.equal(harness.state.orders.get(order.id).status, OrderStatus.TOLANDI);
        const activeAfterPayment = await invoke(harness, 'GET /api/orders', null, { user: waiter, query: { active: 'true' } });
        assert.equal(activeAfterPayment.body.length, 0);
    });

    for (const [label, method] of [
        ['NAQD', PaymentMethod.NAQD], ['Naqd', PaymentMethod.NAQD],
        ['PLASTIK', PaymentMethod.PLASTIK], ['Plastik karta', PaymentMethod.PLASTIK],
        ['ELEKTRON', PaymentMethod.ELEKTRON], ['Elektron to‘lov', PaymentMethod.ELEKTRON]
    ]) {
        await check(`Stol to‘lovi ${label} usulida qabul qilinadi va panellar yangilanadi`, async () => {
            const harness = setup({ paid: ['20'] });
            const response = await pay(harness, label);
            assert.equal(response.code, 200);
            assert.equal(harness.state.payments.length, 1);
            assert.equal(harness.state.payments[0].method, method);
            assert.equal(harness.state.payments[0].amount.toString(), '80');
            assert.equal(harness.state.orders.get('order-1').status, OrderStatus.TOLANDI);
            assert.ok(harness.state.orders.get('order-1').paidAt instanceof Date);
            assert.equal(harness.state.receipts.length, 1);
            assert.equal(harness.state.printJobs.length, 1);
            assert.equal(harness.state.audits[0].action, 'PAYMENT_RECEIVED');
            assert.equal(harness.state.packaging.length, 1);
            assert.equal(harness.state.recipes.length, 1);
            assert.equal(harness.state.movements.length, method === PaymentMethod.NAQD ? 1 : 0);
            assertPaymentEvents(harness, OrderStatus.TOLANDI);
            const lockIndex = harness.state.queryLog.findIndex(entry => typeof entry === 'object' && entry.sql.includes('FOR UPDATE'));
            assert.ok(lockIndex >= 0 && lockIndex < harness.state.queryLog.indexOf('orders-read'), 'To‘lov qoldig‘i o‘qilishidan oldin buyurtmalar band qilinadi');
        });
    }

    await check('Oldingi to‘lov va qarz qoldiqdan ayriladi; qarz qolsa QISMAN_TOLANDI yuboriladi', async () => {
        const harness = setup({ paid: ['20'], debt: { amount: '25', remaining: '10' } });
        const response = await pay(harness, 'ELEKTRON');
        assert.equal(response.code, 200);
        assert.equal(harness.state.payments[0].amount.toString(), '55');
        assert.equal(harness.state.orders.get('order-1').paidAt, null);
        assert.equal(harness.state.recipes.length, 0);
        assertPaymentEvents(harness, OrderStatus.QISMAN_TOLANDI);
    });

    await check('Takroriy so‘rov yangi to‘lov yaratmay, saqlangan natijani qaytaradi', async () => {
        const harness = setup();
        const first = await pay(harness, 'NAQD');
        const eventCount = harness.events.length;
        const replay = await pay(harness, 'NAQD');
        assert.equal(first.code, 200);
        assert.equal(replay.code, 200);
        assert.equal(replay.body.duplicate, true);
        assert.deepEqual(replay.body.data, first.body.data);
        assert.equal(harness.state.payments.length, 1);
        assert.equal(harness.state.receipts.length, 1);
        assert.equal(harness.state.movements.length, 1);
        assert.equal(harness.events.length, eventCount);
    });

    await check('Bir xil identifikator bilan boshqa to‘lov usulini yuborish rad etiladi', async () => {
        const harness = setup();
        await pay(harness, 'NAQD');
        const response = await pay(harness, 'PLASTIK');
        assert.equal(response.code, 409);
        assert.equal(harness.state.payments.length, 1);
    });

    await check('Bir vaqtdagi takroriy so‘rovlar bitta to‘lov, chek va kassa harakatini saqlaydi', async () => {
        const harness = setup();
        const responses = await Promise.all([pay(harness, 'NAQD'), pay(harness, 'NAQD')]);
        assert.ok(responses.every(response => response.code === 200));
        assert.equal(responses.filter(response => response.body.duplicate).length, 1);
        assert.deepEqual(responses[0].body.data, responses[1].body.data);
        assert.equal(harness.state.payments.length, 1);
        assert.equal(harness.state.receipts.length, 1);
        assert.equal(harness.state.movements.length, 1);
        assert.equal(harness.state.idempotency.size, 1);
    });

    await check('Bir vaqtda turli identifikatorlar bilan bitta buyurtmani ikki marta to‘lab bo‘lmaydi', async () => {
        const harness = setup();
        const responses = await Promise.all([pay(harness, 'NAQD', 'table-payment-key-0001'), pay(harness, 'PLASTIK', 'table-payment-key-0002')]);
        assert.deepEqual(responses.map(response => response.code).sort(), [200, 409]);
        assert.equal(harness.state.payments.length, 1);
        assert.equal(harness.state.orders.get('order-1').payments.reduce((sum, payment) => sum.plus(payment.amount), decimal(0)).toString(), '100');
    });

    await check('Boshqa kassir band qilgan buyurtma to‘lovi yozuv va hodisa yaratmay rad etiladi', async () => {
        const harness = setup({ processingById: 'cashier-2' });
        const response = await pay(harness, 'NAQD');
        assert.equal(response.code, 409);
        assert.equal(harness.state.payments.length, 0);
        assert.equal(harness.state.receipts.length, 0);
        assert.equal(harness.events.length, 0);
    });

    await check('To‘langan buyurtmaga yangi identifikator bilan yana to‘lov qabul qilinmaydi', async () => {
        const harness = setup({ status: OrderStatus.TOLANDI, paid: ['100'] });
        const response = await pay(harness, 'NAQD');
        assert.equal(response.code, 409);
        assert.equal(harness.state.payments.length, 0);
        assert.equal(harness.events.length, 0);
    });

    await check('Noto‘g‘ri usul va identifikatorsiz so‘rovlar to‘lov saqlanishidan oldin rad etiladi', async () => {
        const harness = setup();
        assert.equal((await pay(harness, 'NOMA_LUM')).code, 400);
        assert.equal((await pay(harness, 'NAQD', '')).code, 400);
        assert.equal(harness.state.payments.length, 0);
    });

    for (const [action, expectedStatus] of [
        ['approve', OrderStatus.TASDIQLANDI], ['reject', OrderStatus.BEKOR_QILINDI]
    ]) {
        const actionName = action === 'approve' ? 'tasdiqlashi' : 'rad etishi';
        await check(`Ofitsiantning buyurtmani ${actionName} odatdagi holat va tarixni saqlaydi`, async () => {
            const harness = setup();
            const response = await invoke(harness, `POST /api/orders/:id/${action}`, { reason: '  Mijoz bekor qildi  ' }, {
                user: waiter, params: { id: 'order-1' }
            });
            assert.equal(response.code, 200);
            assert.equal(harness.state.orders.get('order-1').status, expectedStatus);
            assert.equal(harness.state.history.length, 1);
            assert.equal(harness.state.history[0].status, expectedStatus);
            assert.equal(harness.state.history[0].userId, waiter.id);
            if (action === 'approve') assert.ok(harness.state.orders.get('order-1').approvedAt instanceof Date);
            if (action === 'reject') assert.equal(harness.state.history[0].comment, 'Mijoz bekor qildi');
            for (const name of ['orderUpdate', 'order_status_updated']) {
                assert.ok(harness.events.some(event => event.name === name && event.data.orderId === 'order-1' && event.data.status === expectedStatus));
            }
        });

        await check(`Ofitsiantning ${actionName} vaqtida qabul qilingan to‘lov TOLANDI holatini saqlaydi`, async () => {
            const harness = setup();
            harness.beforeNextTransaction(state => {
                const order = state.orders.get('order-1');
                assert.equal(order.status, OrderStatus.YANGI, 'Ofitsiant dastlab kutayotgan buyurtma holatini oladi');
                order.status = OrderStatus.TOLANDI;
                order.paidAt = new Date();
            });
            const response = await invoke(harness, `POST /api/orders/:id/${action}`, {}, {
                user: waiter, params: { id: 'order-1' }
            });
            assert.equal(response.code, 409);
            assert.equal(harness.state.orders.get('order-1').status, OrderStatus.TOLANDI);
            assert.ok(harness.state.orders.get('order-1').paidAt instanceof Date);
            assert.equal(harness.state.history.length, 0);
            assert.equal(harness.events.length, 0);
        });

        await check(`Ofitsiantning ${actionName} vaqtida kassir band qilgan buyurtma himoyalanadi`, async () => {
            const harness = setup();
            harness.beforeNextTransaction(state => { state.orders.get('order-1').processingById = 'cashier-2'; });
            const response = await invoke(harness, `POST /api/orders/:id/${action}`, {}, {
                user: waiter, params: { id: 'order-1' }
            });
            assert.equal(response.code, 409);
            assert.equal(harness.state.orders.get('order-1').status, OrderStatus.YANGI);
            assert.equal(harness.state.orders.get('order-1').processingById, 'cashier-2');
            assert.equal(harness.state.history.length, 0);
            assert.equal(harness.events.length, 0);
        });
    }
    console.log(`Haqiqiy so‘rov ishlovchilarida ${checks} ta ofitsiant va stol to‘lovi tekshiruvi bajarildi. Ishchi ma’lumotlar bazasiga ulanilmadi.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
