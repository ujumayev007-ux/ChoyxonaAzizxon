const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), client = require('@prisma/client');
test('Ombor sanog‘i eskirgan qoldiqni rad etadi va to‘g‘ri tuzatishni auditga yozadi', async () => {
    let handler, writes = [], audits = [], movements = [], events = [];
    const product = { id: 'stock', quantity: new client.Prisma.Decimal(10), minQuantity: new client.Prisma.Decimal(2) };
    const tx = { $queryRaw: async () => [], inventoryProduct: { findUniqueOrThrow: async () => product, update: async args => writes.push(args) }, inventoryTransaction: { create: async args => movements.push(args) }, auditLog: { create: async args => audits.push(args) } };
    const context = { exports: {}, console, require(name) {
        if (name === 'express') return { Router: () => ({ use() {}, get() {}, post(_path, callback) { handler = callback; } }) };
        if (name === '../utils/db') return { prisma: { $transaction: callback => callback(tx) } };
        if (name === '../middleware/auth') return { authenticateToken() {}, requireRole: () => () => {} };
        if (name === '../socket') return { emitSocketEvent: (...args) => events.push(args) };
        return require(name);
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/routes/admin-inventory.routes.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    async function send(expected) { let code = 200; await handler({ user: { id: 'admin' }, body: { items: [{ id: 'stock', expected, quantity: '8', minQuantity: '3' }], reason: 'Sanoq tekshiruvi' } }, { status(n) { code = n; return this; }, json() {} }); return code; }
    assert.equal(await send('9'), 409); assert.equal(writes.length, 0);
    assert.equal(await send('10'), 200); assert.equal(writes[0].data.quantity.toString(), '8');
    assert.equal(movements[0].data.quantityChange.toString(), '-2');
    assert.equal(audits[0].data.userId, 'admin'); assert.equal(events[0][0], 'inventory_updated');
});
