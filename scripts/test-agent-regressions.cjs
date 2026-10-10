const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');

const html = fs.readFileSync('public/cashier/index.html', 'utf8');
const submitCode = html.slice(html.indexOf('async function submitPayment('), html.indexOf('function openDebtPayment('));

async function pay(values) {
    const button = { disabled: false };
    const error = { textContent: '', classList: { remove() {} } };
    const calls = [];
    const context = vm.createContext({
        state: { currentOrder: { id: 'order', totalAmount: 130000, payments: [] }, tab: 'orders' },
        FormData: class { entries() { return Object.entries(values); } },
        api: async (url, request) => calls.push({ url, body: JSON.parse(request.body) }),
        closeModal() {}, toast() {}, switchTab: async () => {}, newKey: () => 'unique-payment-key'
    });
    vm.runInContext(submitCode, context);
    await context.submitPayment({ preventDefault() {}, currentTarget: {
        querySelector: selector => selector === 'button[type="submit"]' ? button : error
    } });
    return { calls, error, button };
}

test('130 ming uchun 200 ming naqd: 70 ming qaytim', async () => {
    const result = await pay({ cash: '200000', given: '200000' });
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].body.payments[0].amount, 130000);
    assert.equal(result.calls[0].body.payments[0].customerGiven, 200000);
    assert.equal(result.button.disabled, false);
    assert.match(html, /<button type="submit" id="confirm-payment-btn"/);
});

test('Alohida mijoz bergan naqd maydoni saqlanadi', async () => {
    const { calls } = await pay({ cash: '130000', given: '200000' });
    assert.equal(calls[0].body.payments[0].customerGiven, 200000);
});

test('Aralash to‘lov va qarz qismlari saqlanadi', async () => {
    const { calls } = await pay({ cash: '80000', given: '100000', card: '30000', debt: '20000', customerId: 'customer' });
    const body = calls[0].body;
    assert.equal(body.payments[0].amount, 80000);
    assert.equal(body.payments[0].customerGiven, 100000);
    assert.equal(body.payments[1].amount, 30000);
    assert.equal(body.debtAmount, 20000);
});

test('Kam pul, ortiqcha karta va mijozsiz qarz yuborilmaydi', async () => {
    for (const values of [{ cash: '100000' }, { card: '200000' }, { cash: '130000', given: '100000' }, { debt: '130000' }]) {
        const result = await pay(values);
        assert.equal(result.calls.length, 0);
        assert.ok(result.error.textContent);
    }
});

test('Barcha HTML sahifalarining ichki JavaScript sintaksisi', () => {
    const files = execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.html'));
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (/src=|type="module"/.test(match[1])) continue;
            new vm.Script(match[2], { filename: file });
        }
    }
});

test('Oshxona holati o‘zgarganda kartadagi tugma va ma’lumot yangilanadi', () => {
    const source = fs.readFileSync('public/kitchen/index.html', 'utf8');
    const code = source.slice(source.indexOf('function getGridColumns('), source.indexOf('async function updateOrderStatus('));
    const grid = { innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; } };
    const context = vm.createContext({
        currentOrders: [], renderTimer: undefined,
        document: { getElementById: id => id === 'kitchen-orders-grid' ? grid : {} },
        setTimeout: callback => { callback(); return 1; }, clearTimeout() {}
    });
    vm.runInContext(code, context);
    const order = { id: 'one', orderNumber: '1', status: 'TASDIQLANDI', createdAt: new Date().toISOString(), items: [] };
    context.renderKitchenOrders([order]);
    assert.match(grid.innerHTML, /Boshlash/);
    assert.match(grid.className, /grid-cols-1/);
    context.renderKitchenOrders([{ ...order, status: 'TAYYORLANMOQDA' }]);
    assert.doesNotMatch(grid.innerHTML, />Boshlash</);
    assert.match(grid.innerHTML, />Tayyor</);
    context.renderKitchenOrders([{ ...order, status: 'TAYYOR' }]);
    assert.match(grid.innerHTML, />Yakunlash</);
    context.renderKitchenOrders([]);
    assert.match(grid.innerHTML, /Hozircha faol buyurtmalar/);
});

test('Ommaviy menyu API faqat faol taomlar beradi va tannarxni yashiradi', async () => {
    const express = require('express');
    const db = require('../dist/utils/db');
    const auth = require('../dist/middleware/auth');
    const queries = [];
    const original = db.prisma.menuItem.findMany;
    const originalOptional = auth.optionalAuthenticateToken;
    db.prisma.menuItem.findMany = async query => { queries.push(query); return []; };
    auth.optionalAuthenticateToken = (_req, _res, next) => next();
    const app = express();
    app.use('/api/menu', require('../dist/routes/menu.routes').default);
    const server = app.listen(0, '127.0.0.1');
    try {
        await new Promise(resolve => server.once('listening', resolve));
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/menu`);
        assert.equal(response.status, 200);
        assert.equal(queries[0].where.isActive, true);
        assert.equal(queries[0].where.category.isActive, true);
        assert.equal(queries[0].select.internalCostPrice, undefined);
        assert.equal(queries[0].select.recipes, undefined);
    } finally {
        await new Promise(resolve => server.close(resolve));
        db.prisma.menuItem.findMany = original;
        auth.optionalAuthenticateToken = originalOptional;
        await db.prisma.$disconnect();
    }
});
