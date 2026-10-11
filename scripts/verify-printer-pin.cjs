const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { hashPin, verifyPin } = require('../src/utils/pin');
const { queueKitchenPrint } = require('../src/utils/kitchen-print');

test('PIN 0 bilan boshlanishi mumkin; tasodifiy tuz va eski PINlar tekshiriladi', async () => {
    const a = await hashPin('0123'), b = await hashPin('0123');
    assert.notEqual(a, b);
    assert.equal(await verifyPin('0123', a), true);
    assert.equal(await verifyPin('0124', a), false);
    assert.equal(await verifyPin('0123', 'broken'), false);
});
test('Kategoriyalar turli printerlarga ajraladi; takroriy chaqiruv chekni ko‘paytirmaydi', async () => {
    const jobs = new Map();
    const allItems = [{ id: 'a', quantity: 2, menuItem: { name: 'Kabob', unit: 'dona', category: { id: 'kabob', name: 'Kaboblar' } } },
        { id: 'b', quantity: 1, menuItem: { name: 'Baliq', unit: 'kg', category: { id: 'fish', name: 'Baliqlar' } } }];
    const tx = {
        order: { findUniqueOrThrow: async query => ({ orderNumber: '1', guestCount: 3, table: { number: 4, room: { name: 'Xona' } },
            waiter: { fullName: 'Akmal' }, items: query.include.items.where.id ? allItems.filter(i => query.include.items.where.id.in.includes(i.id)) : allItems }) },
        printer: { findMany: async () => [{ id: 'p1', department: 'Kabobxona', categoryIds: ['kabob'] }, { id: 'p2', department: 'Baliqxona', categoryIds: ['fish'] }] },
        printConfig: { findUnique: async () => ({ header: 'Restoran', footer: 'Rahmat' }) },
        printJob: { upsert: async ({ where, create }) => { if (!jobs.has(where.id)) jobs.set(where.id, create); } }
    };
    await queueKitchenPrint(tx, 'order', 'initial'); await queueKitchenPrint(tx, 'order', 'initial');
    assert.equal(jobs.size, 2);
    const values = [...jobs.values()];
    assert.equal(JSON.parse(values.find(j => j.printerId === 'p1').payload).items[0].name, 'Kabob');
    assert.equal(JSON.parse(values.find(j => j.printerId === 'p2').payload).items[0].name, 'Baliq');
    await queueKitchenPrint(tx, 'order', 'addition', ['b']);
    assert.equal(jobs.size, 3);
    assert.equal(JSON.parse([...jobs.values()][2].payload).items.length, 1);
    tx.printer.findMany = async () => [];
    await queueKitchenPrint(tx, 'other', 'initial');
    assert.equal([...jobs.values()].filter(j => j.printerId === null).length, 2);
});
test('Admin, ofitsant va kassir PIN orqali kiradi; noto‘g‘ri rol va ko‘p urinishlar rad etiladi', async () => {
    const { RoleType } = require('@prisma/client');
    for (const role of ['ADMIN', 'WAITER', 'CASHIER']) {
        let handler, cookies = 0;
        const context = vm.createContext({ exports: {}, console, require(name) {
            if (name === 'express') return { Router: () => ({ post: (_path, fn) => { handler = fn; } }) };
            if (name === '../utils/db') return { prisma: { user: { findMany: async query => {
                assert.ok(query.where.role.in.includes(role));
                return [{ id: 'user', role, pinCodeHash: 'hashed', updatedAt: new Date() }];
            } } } };
            if (name === '../utils/pin') return { verifyPin: async pin => pin === '0123' };
            if (name === '../middleware/auth') return { setAuthCookie: () => cookies++ };
            if (name === '@prisma/client') return { RoleType };
            return require(name);
        } });
        vm.runInContext(ts.transpile(fs.readFileSync('src/routes/auth-pin.routes.ts', 'utf8')), context);
        async function call(pin, selectedRole = role) {
            let status = 200;
            await handler({ ip: 'test', body: { pin, role: selectedRole } }, { status(code) { status = code; return this; }, json() {} });
            return status;
        }
        assert.equal(await call('0123'), 200); assert.equal(cookies, 1);
        assert.equal(await call('0123', 'KITCHEN'), 401);
        for (let i = 0; i < 4; i++) assert.equal(await call('9999'), 401);
        assert.equal(await call('0123'), 429);
        assert.equal(cookies, 1);
    }
});
