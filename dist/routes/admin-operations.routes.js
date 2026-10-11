"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const net_1 = require("net");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const pin_1 = require("../utils/pin");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
router.get('/operations', async (_req, res) => {
    try {
        const [printers, categories, users, config, jobs] = await Promise.all([
            db_1.prisma.printer.findMany({ orderBy: { name: 'asc' } }), db_1.prisma.menuCategory.findMany({ orderBy: { name: 'asc' } }),
            db_1.prisma.user.findMany({ where: { role: { in: ['ADMIN', 'WAITER', 'CASHIER'] } }, select: { id: true, fullName: true, username: true, role: true, pinCodeHash: true } }),
            db_1.prisma.printConfig.findUnique({ where: { id: 'default' } }),
            db_1.prisma.printJob.findMany({ where: { jobType: 'KITCHEN' }, take: 30, orderBy: { createdAt: 'desc' }, select: { id: true, printerId: true, status: true, createdAt: true, order: { select: { orderNumber: true } } } })
        ]);
        res.json({ printers, categories, users: users.map(({ pinCodeHash, ...user }) => ({ ...user, hasPin: Boolean(pinCodeHash) })),
            config: { header: config?.header || 'ChoyxonaAzizxon', footer: config?.footer || '', agentConfigured: Boolean(config?.agentTokenHash) }, jobs });
    }
    catch {
        res.status(500).json({ message: 'Sozlamalarni yuklab bo‘lmadi' });
    }
});
router.put('/users/:id/pin', async (req, res) => {
    const pin = req.body?.pin;
    if (pin !== null && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
        res.status(400).json({ message: 'PIN aynan 4 ta raqam bo‘lishi kerak' });
        return;
    }
    try {
        const user = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707370)`;
            const current = await tx.user.findUnique({ where: { id: req.params.id } });
            if (!current || !['ADMIN', 'WAITER', 'CASHIER'].includes(current.role))
                throw new Error('NOT_FOUND');
            if (pin !== null) {
                const others = await tx.user.findMany({ where: { id: { not: current.id }, pinCodeHash: { not: null } }, select: { pinCodeHash: true } });
                for (const other of others)
                    if (await (0, pin_1.verifyPin)(pin, other.pinCodeHash))
                        throw new Error('DUPLICATE');
            }
            const updated = await tx.user.update({ where: { id: current.id }, data: { pinCodeHash: pin === null ? null : await (0, pin_1.hashPin)(pin) }, select: { id: true, role: true, updatedAt: true } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'EMPLOYEE_PIN_UPDATED', entity: 'User', entityId: current.id,
                    newValue: JSON.stringify({ pinEnabled: pin !== null }) } });
            return updated;
        }, { maxWait: 10000, timeout: 30000 });
        if (user.id === req.user.id)
            (0, auth_1.setAuthCookie)(res, user);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ message: error instanceof Error && error.message === 'DUPLICATE' ? 'Bu PIN boshqa xodimga biriktirilgan' : 'PIN saqlanmadi. Foydalanuvchini tekshiring' });
    }
});
router.put('/printers/:id', async (req, res) => {
    const { name, department, ipAddress, port, paperWidth, isActive, categoryIds, connectionType } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof department !== 'string' || !department.trim() || department.length > 100 ||
        typeof ipAddress !== 'string' || !ipAddress.trim() || ipAddress.length > 200 || !['TCP', 'WINDOWS'].includes(connectionType) ||
        (connectionType === 'TCP' && !(0, net_1.isIP)(ipAddress)) || !Number.isInteger(port) || port < 1 || port > 65535 ||
        ![58, 80].includes(paperWidth) || typeof isActive !== 'boolean' || !Array.isArray(categoryIds) || categoryIds.some(id => typeof id !== 'string')) {
        res.status(400).json({ message: 'Printer nomi, ulanish manzili, port va kategoriyalarni to‘g‘ri kiriting' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707371)`;
            const ids = [...new Set(categoryIds)];
            if (await tx.menuCategory.count({ where: { id: { in: ids } } }) !== ids.length)
                throw new Error('CATEGORY');
            const conflict = isActive && await tx.printer.findFirst({ where: { id: { not: req.params.id }, isActive: true, categoryIds: { hasSome: ids } } });
            if (conflict)
                throw new Error('CONFLICT');
            const data = { name: name.trim(), department: department.trim(), ipAddress: ipAddress.trim(), port, paperWidth, isActive, categoryIds: ids, connectionType };
            if (req.params.id === 'new')
                await tx.printer.create({ data });
            else
                await tx.printer.update({ where: { id: req.params.id }, data });
        }, { maxWait: 10000, timeout: 30000 });
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ message: error instanceof Error && error.message === 'CONFLICT' ? 'Kategoriya boshqa faol printerga biriktirilgan' : 'Printer saqlanmadi' });
    }
});
router.put('/print-config', async (req, res) => {
    const { header, footer } = req.body || {};
    if (typeof header !== 'string' || typeof footer !== 'string' || header.length > 150 || footer.length > 250) {
        res.status(400).json({ message: 'Chek matni noto‘g‘ri' });
        return;
    }
    try {
        await db_1.prisma.printConfig.upsert({ where: { id: 'default' }, create: { id: 'default', header, footer }, update: { header, footer } });
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ message: 'Chek sozlamalari saqlanmadi' });
    }
});
router.post('/print-agent-token', async (_req, res) => {
    try {
        const token = (0, crypto_1.randomBytes)(32).toString('hex'), agentTokenHash = (0, crypto_1.createHash)('sha256').update(token).digest('hex');
        await db_1.prisma.printConfig.upsert({ where: { id: 'default' }, create: { id: 'default', agentTokenHash }, update: { agentTokenHash } });
        res.json({ token });
    }
    catch {
        res.status(500).json({ message: 'Ulash kaliti yaratilmadi' });
    }
});
router.post('/print-jobs/:id/retry', async (req, res) => {
    try {
        const result = await db_1.prisma.printJob.updateMany({ where: { id: req.params.id, jobType: 'KITCHEN', status: { in: ['XATOLIK', 'CHOP_ETILMOQDA'] } }, data: { status: 'KUTILMOQDA' } });
        res.json({ success: result.count > 0 });
    }
    catch {
        res.status(500).json({ message: 'Chek navbatga qaytarilmadi' });
    }
});
exports.default = router;
