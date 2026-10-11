const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
test('Xodim yaratish PINni xeshlaydi va auditga maxfiy qiymatlarni yozmaydi', async () => {
    let handler, stored, audit;
    const tx = { $queryRaw: async () => [],
        user: { findMany: async () => [], create: async ({ data }) => { stored = data; return { id: 'new', username: data.username, role: data.role, fullName: data.fullName }; } },
        waiterProfile: { upsert: async () => {} }, auditLog: { create: async ({ data }) => { audit = data; } } };
    const ctx = vm.createContext({ exports: {}, require(name) {
        if (name === 'express') return { Router: () => ({ use() {}, get() {}, post(_path, fn) { handler = fn; }, put() {} }) };
        if (name === '../utils/db') return { prisma: { $transaction: async fn => fn(tx) } };
        if (name === '../middleware/auth') return { authenticateToken() {}, requireRole: () => () => {}, setAuthCookie() {} };
        if (name === '../utils/pin') return { hashPin: async () => 'hashed-pin', verifyPin: async () => false };
        if (name === '../utils/password') return { hashPassword: async () => 'hashed-password' };
        return require(name);
    } });
    vm.runInContext(ts.transpile(fs.readFileSync('src/routes/employees.routes.ts', 'utf8')), ctx);
    let status, response;
    await handler({ params: {}, user: { id: 'admin' }, body: { username: 'staff', fullName: 'Xodim', phone: '', role: 'WAITER', password: 'test-password-123', pin: '0123', avatar: 'chef' } },
        { status(code) { status = code; return this; }, json(data) { response = data; } });
    assert.equal(status, 201); assert.equal(stored.pinCodeHash, 'hashed-pin'); assert.equal(stored.avatar, 'chef');
    const serialized = JSON.stringify({ audit, response });
    for (const secret of ['0123', 'test-password-123', 'hashed-pin', 'hashed-password']) assert.ok(!serialized.includes(secret));
    assert.equal(audit.userId, 'admin'); assert.equal(audit.action, 'EMPLOYEE_CREATED');
});
