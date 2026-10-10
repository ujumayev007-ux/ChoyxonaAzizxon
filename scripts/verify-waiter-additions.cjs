const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const client = require('@prisma/client');
const { test } = require('node:test');
const decimal = value => new client.Prisma.Decimal(value);

function setup(overrides = {}) {
    const order = { id: 'order-1', waiterId: 'waiter-1', tableId: 'table-1', status: 'STOLGA_YETKAZILDI',
        payments: [], debt: null, processingById: null, subtotal: decimal(66000), totalAmount: decimal(65000), ...overrides };
    let handler, saved, writes = 0, oldItemsStatus;
    const events = [], lines = [];
    const tx = {
        $queryRaw: async () => [],
        idempotencyRecord: { findUnique: async () => saved, create: async ({ data }) => { saved = data; } },
        menuItem: { findMany: async () => [{ id: 'food-1', sellingPrice: decimal('22000.25') }] },
        orderItem: { updateMany: async ({ data }) => { oldItemsStatus = data.status; } },
        order: {
            findUnique: async () => order,
            update: async ({ data }) => {
                writes++;
                lines.push(...data.items.create);
                order.totalAmount = order.totalAmount.plus(data.totalAmount.increment);
                order.subtotal = order.subtotal.plus(data.subtotal.increment);
                order.status = data.status;
                return { id: order.id, tableId: order.tableId, totalAmount: order.totalAmount, status: order.status };
            }
        }
    };
    const prisma = { $transaction: async callback => callback(tx) };
    const context = vm.createContext({ exports: {}, console, Date, require(name) {
        if (name === 'express') return { Router: () => ({ post: (_path, ...callbacks) => { handler = callbacks.at(-1); } }) };
        if (name === '../utils/db') return { prisma };
        if (name === '../middleware/auth') return { authenticateToken() {}, requireRole: () => () => {} };
        if (name === '../socket') return { emitSocketEvent: (...args) => events.push(args) };
        return require(name);
    } });
    vm.runInContext(ts.transpileModule(fs.readFileSync('src/routes/waiter-orders.routes.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, context);
    const body = { items: [{ productId: 'food-1', quantity: 2, note: 'Tuzsiz' }], idempotencyKey: 'addition-request-12345' };
    return { order, events, lines, get writes() { return writes; }, get oldItemsStatus() { return oldItemsStatus; },
        async send(changes = {}, userId = 'waiter-1') {
            let status = 200, result;
            await handler({ params: { id: order.id }, user: { id: userId }, body: { ...body, ...changes } }, {
                status(value) { status = value; return this; }, json(value) { result = value; }
            });
            return { status, result };
        }
    };
}
test('Qo‘shimcha taomlar joriy narxda qo‘shiladi, chegirma va eski taomlar saqlanadi', async () => {
    const h = setup();
    assert.equal((await h.send()).status, 200);
    assert.equal(h.order.totalAmount.toString(), '109000.5');
    assert.equal(h.order.subtotal.toString(), '110000.5');
    assert.equal(h.order.status, 'TASDIQLANDI');
    assert.equal(h.oldItemsStatus, 'TAYYOR');
    assert.equal(h.lines[0].status, 'YANGI');
    assert.ok(h.events.some(([event]) => event === 'orderUpdate'));
});
test('Takroriy yuborish taomlarni ikki marta qo‘shmaydi', async () => {
    const h = setup();
    await h.send();
    assert.equal((await h.send()).result.data.duplicate, true);
    assert.equal(h.writes, 1);
    assert.equal((await h.send({ items: [{ productId: 'food-1', quantity: 3 }] })).status, 409);
});
test('Boshqa ofitsant, to‘langan buyurtma va faol kassir bandligi himoyalanadi', async () => {
    assert.equal((await setup().send({}, 'waiter-2')).status, 403);
    for (const options of [{ status: 'TOLANDI' }, { payments: [{}] }, { debt: {} },
        { processingById: 'cashier', processingAt: new Date() }, { recipesDeductedAt: new Date() }]) {
        const h = setup(options);
        assert.equal((await h.send()).status, 409);
        assert.equal(h.writes, 0);
        assert.equal(h.events.length, 0);
    }
});
test('Eski bandlik qo‘shimchaga to‘sqinlik qilmaydi; tayyorlanayotgan buyurtma holati saqlanadi', async () => {
    const h = setup({ status: 'TAYYORLANMOQDA', processingById: 'cashier', processingAt: new Date(0) });
    assert.equal((await h.send()).status, 200);
    assert.equal(h.order.status, 'TAYYORLANMOQDA');
});
test('Noto‘g‘ri miqdor va mavjud bo‘lmagan taom yozilmaydi', async () => {
    for (const quantity of [0, -1, 'abc', Infinity]) {
        const h = setup();
        assert.equal((await h.send({ items: [{ productId: 'food-1', quantity }] })).status, 400);
        assert.equal(h.writes, 0);
    }
    assert.equal((await setup().send({ items: [{ productId: 'missing', quantity: 1 }] })).status, 400);
});

test('Ofitsant oynasi qo‘shimchani kerakli buyurtmaga yuboradi va tarmoq xatosida ayni kalitni takrorlaydi', async () => {
    const html = fs.readFileSync('public/waiter/index.html', 'utf8');
    const fields = {
        'submit-waiter-order': { disabled: false }, 'builder-table-select': { value: 'table-1' },
        'builder-guest-count': { value: '2' }, 'order-general-note': { value: '' }
    };
    const calls = [];
    const context = vm.createContext({
        console: { error() {} }, crypto: { randomUUID: () => 'same-retry-key-12345' },
        appendOrder: { id: 'order-1' }, appendRequest: null, cartItems: [{ id: 'food-1', quantity: 2, note: '' }],
        document: { getElementById: id => fields[id] }, alert() {}, showNotification() {}, renderCart() {}, switchTab() {},
        cancelAppendOrder() { context.appendOrder = null; context.appendRequest = null; },
        fetch: async (url, request) => {
            calls.push({ url, body: JSON.parse(request.body) });
            if (calls.length === 1) throw new Error('Network timeout');
            return { ok: true, json: async () => ({ success: true }) };
        }
    });
    vm.runInContext(html.slice(html.indexOf('async function submitWaiterOrder('), html.indexOf('async function loadTableDropdowns(')), context);
    await context.submitWaiterOrder();
    assert.equal(context.cartItems.length, 1);
    await context.submitWaiterOrder();
    assert.equal(calls[0].url, '/api/waiter/orders/order-1/items');
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(context.cartItems.length, 0);
    assert.equal(fields['submit-waiter-order'].disabled, false);
});
