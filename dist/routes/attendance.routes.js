"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const pin_1 = require("../utils/pin");
const attendance_1 = require("../utils/attendance");
const qrcode = require('qrcode');
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN', 'WAITER', 'CASHIER', 'KITCHEN']));
const admin = (0, auth_1.requireRole)(['ADMIN']);
const attempts = new Map();
router.get('/me', (req, res) => res.json({ role: req.user.role, fullName: req.user.fullName }));
router.get('/config', async (_req, res) => {
    try {
        res.json(await db_1.prisma.attendanceConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} }));
    }
    catch {
        res.status(500).json({ message: 'Davomat sozlamalari yuklanmadi' });
    }
});
router.put('/config', admin, async (req, res) => {
    const { enabled, methods, startTime, endTime, timezone, graceMinutes } = req.body || {};
    try {
        if (typeof enabled !== 'boolean' || !Array.isArray(methods) || !methods.length || methods.some(m => !['PIN', 'QR'].includes(m)) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
            typeof timezone !== 'string' || !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120)
            throw Error();
        new Intl.DateTimeFormat('uz-UZ', { timeZone: timezone });
        const data = { enabled, methods: [...new Set(methods)], startTime, endTime, timezone, graceMinutes };
        await db_1.prisma.$transaction(async (tx) => {
            const old = await tx.attendanceConfig.findUnique({ where: { id: 'default' } });
            await tx.attendanceConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'ATTENDANCE_SETTINGS', entity: 'AttendanceConfig', entityId: 'default', oldValue: JSON.stringify(old), newValue: JSON.stringify(data) } });
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Davomat jadvali yoki usullari noto‘g‘ri' });
    }
});
router.get('/history', async (req, res) => {
    const from = new Date(String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString()));
    const to = new Date(String(req.query.to || new Date().toISOString()));
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from || to.getTime() - from.getTime() > 93 * 86400000) {
        res.status(400).json({ message: 'Sana oralig‘i 93 kundan oshmasin' });
        return;
    }
    try {
        const rows = await db_1.prisma.waiterShift.findMany({ where: { checkInTime: { gte: from, lte: to },
                ...(req.user.role === 'ADMIN' ? (req.query.userId ? { waiterId: String(req.query.userId) } : {}) : { waiterId: req.user.id }) },
            include: { waiter: { select: { fullName: true } } }, orderBy: { checkInTime: 'desc' }, take: 500 });
        const active = await db_1.prisma.waiterShift.findFirst({ where: { waiterId: req.user.id, checkOutTime: null }, orderBy: { checkInTime: 'desc' } });
        res.json({ rows, active });
    }
    catch {
        res.status(500).json({ message: 'Davomat tarixi yuklanmadi' });
    }
});
router.post('/qr', admin, async (_req, res) => {
    try {
        const token = (0, crypto_1.randomBytes)(24).toString('hex'), id = (0, crypto_1.createHash)('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 60000);
        await db_1.prisma.attendanceChallenge.create({ data: { id, expiresAt } });
        res.json({ image: await qrcode.toDataURL(`CHOYXONA_ATTENDANCE:${token}`), expiresAt });
    }
    catch {
        res.status(500).json({ message: 'QR yaratilmadi' });
    }
});
router.post('/punch', async (req, res) => {
    const { action, method, pin, token } = req.body || {};
    if (!['IN', 'OUT'].includes(action) || !['PIN', 'QR'].includes(method)) {
        res.status(400).json({ message: 'Davomat amali noto‘g‘ri' });
        return;
    }
    const key = req.user.id, previous = attempts.get(key);
    if (previous && previous.until > Date.now() && previous.count >= 5) {
        res.status(429).json({ message: 'Urinishlar ko‘p. 5 daqiqadan keyin urinib ko‘ring' });
        return;
    }
    const limit = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 300000 };
    limit.count++;
    attempts.set(key, limit);
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "User" WHERE "id"=${key} FOR UPDATE`;
            const config = await tx.attendanceConfig.findUnique({ where: { id: 'default' } });
            if (!config?.enabled || !config.methods.includes(method))
                throw new Error('DISABLED');
            if (method === 'PIN') {
                const user = await tx.user.findUniqueOrThrow({ where: { id: key } });
                if (typeof pin !== 'string' || !/^\d{4}$/.test(pin) || !user.pinCodeHash || !await (0, pin_1.verifyPin)(pin, user.pinCodeHash))
                    throw new Error('VERIFY');
            }
            else {
                if (typeof token !== 'string' || token.length !== 48)
                    throw new Error('VERIFY');
                const challenge = await tx.attendanceChallenge.findUnique({ where: { id: (0, crypto_1.createHash)('sha256').update(token).digest('hex') } });
                if (!challenge || challenge.expiresAt < new Date())
                    throw new Error('VERIFY');
            }
            const now = new Date(), open = await tx.waiterShift.findFirst({ where: { waiterId: key, checkOutTime: null }, orderBy: { checkInTime: 'desc' } });
            if ((action === 'IN' && open) || (action === 'OUT' && !open))
                throw new Error('STATE');
            let shift;
            if (action === 'IN') {
                const schedule = (0, attendance_1.scheduleFor)(now, config.startTime, config.endTime, config.timezone);
                shift = await tx.waiterShift.create({ data: { waiterId: key, checkInTime: now, date: schedule.start, scheduledStart: schedule.start, scheduledEnd: schedule.end,
                        scheduleGrace: config.graceMinutes, checkInMethod: method, ...(0, attendance_1.attendanceMetrics)(now, null, schedule.start, schedule.end, config.graceMinutes) } });
            }
            else {
                shift = await tx.waiterShift.update({ where: { id: open.id }, data: { checkOutTime: now, checkOutMethod: method,
                        ...(0, attendance_1.attendanceMetrics)(open.checkInTime, now, open.scheduledStart, open.scheduledEnd, open.scheduleGrace) } });
            }
            await tx.auditLog.create({ data: { userId: key, action: action === 'IN' ? 'ATTENDANCE_IN' : 'ATTENDANCE_OUT', entity: 'WaiterShift', entityId: shift.id, newValue: JSON.stringify({ method }) } });
            return shift;
        }, { maxWait: 10000, timeout: 30000 });
        attempts.delete(key);
        res.json({ success: true, data: result });
    }
    catch (error) {
        const messages = { DISABLED: 'Davomat yoki bu usul o‘chirilgan', VERIFY: 'PIN yoki QR noto‘g‘ri yoki muddati tugagan', STATE: 'Kirish/chiqish holatini yangilang' };
        res.status(400).json({ message: messages[error instanceof Error ? error.message : ''] || 'Davomat saqlanmadi' });
    }
});
router.put('/history/:id', admin, async (req, res) => {
    const start = new Date(req.body?.checkInTime), end = req.body?.checkOutTime ? new Date(req.body.checkOutTime) : null;
    const reason = req.body?.reason;
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end < start)) || start > new Date() || (end && end > new Date()) || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) {
        res.status(400).json({ message: 'Vaqtlarni va tuzatish sababini to‘g‘ri kiriting' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            const original = await tx.waiterShift.findUniqueOrThrow({ where: { id: req.params.id } });
            await tx.$queryRaw `SELECT "id" FROM "User" WHERE "id"=${original.waiterId} FOR UPDATE`;
            const old = await tx.waiterShift.findUniqueOrThrow({ where: { id: original.id } });
            const overlap = await tx.waiterShift.findFirst({ where: { id: { not: old.id }, waiterId: old.waiterId,
                    checkInTime: { lt: end || new Date('9999-01-01') }, OR: [{ checkOutTime: null }, { checkOutTime: { gt: start } }] } });
            if (overlap)
                throw Error('OVERLAP');
            const updated = await tx.waiterShift.update({ where: { id: old.id }, data: { checkInTime: start, checkOutTime: end, correctionReason: reason.trim(),
                    ...(0, attendance_1.attendanceMetrics)(start, end, old.scheduledStart, old.scheduledEnd, old.scheduleGrace) } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'ATTENDANCE_CORRECTED', entity: 'WaiterShift', entityId: old.id, oldValue: JSON.stringify(old), newValue: JSON.stringify(updated) } });
        }, { maxWait: 10000, timeout: 30000 });
        res.json({ success: true });
    }
    catch {
        res.status(409).json({ message: 'Tuzatish saqlanmadi: smenalar ustma-ust tushmasligi kerak' });
    }
});
exports.default = router;
