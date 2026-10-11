const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { scheduleFor, attendanceMetrics } = require('../src/utils/attendance');
test('Toshkent smenasi, imtiyoz, kechikish va erta chiqish hisoblanadi', () => {
    const now = new Date('2026-10-11T04:20:00Z');
    const schedule = scheduleFor(now, '09:00', '18:00', 'Asia/Tashkent');
    assert.equal(schedule.start.toISOString(), '2026-10-11T04:00:00.000Z');
    assert.equal(schedule.end.toISOString(), '2026-10-11T13:00:00.000Z');
    assert.deepEqual(attendanceMetrics(now, new Date('2026-10-11T12:30:00Z'), schedule.start, schedule.end, 10), { lateMinutes: 10, earlyMinutes: 30, totalHours: 8.17 });
});
test('Tun bo‘yi smena to‘g‘ri kunga biriktiriladi', () => {
    const schedule = scheduleFor(new Date('2026-10-10T22:00:00Z'), '22:00', '06:00', 'Asia/Tashkent');
    assert.equal(schedule.start.toISOString(), '2026-10-10T17:00:00.000Z');
    assert.equal(schedule.end.toISOString(), '2026-10-11T01:00:00.000Z');
    assert.equal(attendanceMetrics(schedule.start, null, schedule.start, schedule.end, 10).totalHours, null);
});

test('Davomat PIN va QRni tekshiradi; takroriy kirish smena yaratmaydi', async () => {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
    const routes = new Map(); let open = null, writes = 0, expired = false;
    const tx = { $queryRaw: async () => [], attendanceConfig: { findUnique: async () => ({ enabled: true, methods: ['PIN', 'QR'], startTime: '09:00', endTime: '18:00', timezone: 'Asia/Tashkent', graceMinutes: 10 }) },
        user: { findUniqueOrThrow: async () => ({ pinCodeHash: 'hash' }) }, attendanceChallenge: { findUnique: async () => ({ expiresAt: new Date(expired ? 0 : Date.now() + 60000) }) },
        waiterShift: { findFirst: async () => open, create: async ({ data }) => { writes++; open = { ...data, id: 'shift' }; return open; } }, auditLog: { create: async () => {} } };
    const ctx = vm.createContext({ exports: {}, console, require(name) {
        if (name === 'express') return { Router: () => ({ use() {}, get() {}, put() {}, post: (p, ...handlers) => routes.set(p, handlers.at(-1)) }) };
        if (name === '../utils/db') return { prisma: { $transaction: async fn => fn(tx) } };
        if (name === '../middleware/auth') return { authenticateToken() {}, requireRole: () => () => {} };
        if (name === '../utils/pin') return { verifyPin: async pin => pin === '0123' };
        if (name === '../utils/attendance') return { scheduleFor, attendanceMetrics };
        return require(name);
    } });
    vm.runInContext(ts.transpile(fs.readFileSync('src/routes/attendance.routes.ts', 'utf8')), ctx);
    async function punch(body) { let status = 200; await routes.get('/punch')({ user: { id: 'waiter' }, body }, { status(s) { status = s; return this; }, json() {} }); return status; }
    assert.equal(await punch({ action: 'IN', method: 'PIN', pin: '9999' }), 400); assert.equal(writes, 0);
    assert.equal(await punch({ action: 'IN', method: 'PIN', pin: '0123' }), 200); assert.equal(writes, 1);
    assert.equal(await punch({ action: 'IN', method: 'PIN', pin: '0123' }), 400); assert.equal(writes, 1);
    expired = true;
    assert.equal(await punch({ action: 'OUT', method: 'QR', token: 'a'.repeat(48) }), 400);
});
