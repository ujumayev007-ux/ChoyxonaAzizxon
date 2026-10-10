const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync('public/waiter/index.html', 'utf8');
const actions = html.slice(html.indexOf('async function approveOrder('), html.indexOf('// Active Orders List'));
function setup(fetch) {
    const alerts = [], refresh = [];
    const fields = {
        'reject-order-id': { value: 'order-1' },
        'reject-reason-input': { value: 'Mijoz bekor qildi' },
        'modal-reject-order': { classList: { add() {}, remove() {} } }
    };
    const context = vm.createContext({
        fetch, pendingOrderActions: new Set(),
        alert: message => alerts.push(message), showNotification() {},
        document: { getElementById: id => fields[id] },
        loadPendingOrders: () => refresh.push('pending'),
        loadActiveOrders: () => refresh.push('active'),
        loadRoomsAndTables: () => refresh.push('tables')
    });
    vm.runInContext(actions, context);
    return { context, alerts, refresh };
}

test('Tasdiqlashni ikki marta bosish bitta so‘rov yuboradi', async () => {
    let resolve, count = 0;
    const h = setup(() => { count++; return new Promise(done => { resolve = done; }); });
    const first = h.context.approveOrder('order-1');
    await h.context.approveOrder('order-1');
    resolve({ ok: true });
    await first;
    assert.equal(count, 1);
    assert.equal(h.context.pendingOrderActions.size, 0);
    assert.ok(h.refresh.includes('active'));
});

test('Rad etish server sababini ko‘rsatadi va eskirgan ro‘yxatni yangilaydi', async () => {
    const h = setup(async () => ({ ok: false, json: async () => ({ message: 'Tizimga qayta kiring' }) }));
    await h.context.confirmRejectOrder();
    assert.deepEqual(h.alerts, ['Tizimga qayta kiring']);
    assert.ok(h.refresh.includes('pending'));
    assert.equal(h.context.pendingOrderActions.size, 0);
});

test('Rad etish sababi yuboriladi va barcha tegishli ro‘yxatlar yangilanadi', async () => {
    const h = setup(async (url, request) => {
        assert.equal(url, '/api/orders/order-1/reject');
        assert.equal(JSON.parse(request.body).reason, 'Mijoz bekor qildi');
        return { ok: true };
    });
    await h.context.confirmRejectOrder();
    for (const section of ['pending', 'active', 'tables']) assert.ok(h.refresh.includes(section));
    assert.equal(h.alerts.length, 0);
});

test('Kechikkan javob yangi kutilayotgan buyurtmalarni almashtirmaydi', async () => {
    const replies = [], rendered = [];
    const context = vm.createContext({
        console, pendingOrdersRequest: 0,
        fetch: () => new Promise(resolve => replies.push(resolve)),
        renderPendingOrders: orders => rendered.push(orders),
        document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) }
    });
    vm.runInContext(html.slice(html.indexOf('async function loadPendingOrders('), html.indexOf('function renderPendingOrders(')), context);
    const older = context.loadPendingOrders();
    const newer = context.loadPendingOrders();
    replies[1]({ ok: true, json: async () => [] });
    await newer;
    replies[0]({ ok: true, json: async () => [{ id: 'already-paid' }] });
    await older;
    assert.deepEqual(rendered, [[]]);
});
