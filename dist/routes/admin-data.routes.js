"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const admin_pin_1 = require("../middleware/admin-pin");
const backups_1 = require("../utils/backups");
const secrets_1 = require("../utils/secrets");
const settings_1 = require("../utils/settings");
const alerts_1 = require("../utils/alerts");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), admin_pin_1.requireAdminPin);
router.get('/backups', async (_req, res) => {
    try {
        res.json(await db_1.prisma.dataBackup.findMany({ take: 100, orderBy: { createdAt: 'desc' }, select: { id: true, actorId: true, status: true, createdAt: true, manifest: true } }));
    }
    catch {
        res.status(500).json({ message: 'Nusxalar tarixi yuklanmadi' });
    }
});
router.post('/backups', async (req, res) => {
    let id;
    try {
        // Verify encryption before reading business data.
        (0, secrets_1.encryptSecret)('check');
        const row = await db_1.prisma.dataBackup.create({ data: { actorId: req.user.id } });
        id = row.id;
        const snapshot = await db_1.prisma.$transaction(backups_1.businessSnapshot, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 });
        const json = JSON.stringify(snapshot);
        if (Buffer.byteLength(json) > 40 * 1024 * 1024)
            throw Error('BACKUP_TOO_LARGE');
        const manifest = Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length]));
        await db_1.prisma.$transaction(async (tx) => {
            await tx.dataBackup.update({ where: { id }, data: { status: 'TAYYOR', encryptedData: (0, secrets_1.encryptSecret)(json), manifest } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'BACKUP_CREATED', entity: 'DataBackup', entityId: id, newValue: JSON.stringify(manifest) } });
        });
        res.status(201).json({ id });
    }
    catch {
        if (id)
            await db_1.prisma.dataBackup.update({ where: { id }, data: { status: 'XATOLIK' } }).catch(() => { });
        await (0, alerts_1.recordFailure)('backupFailures');
        res.status(500).json({ message: 'Nusxa yaratilmagan. Server shifrlash kaliti, ma’lumot hajmi va ulanishni tekshiring' });
    }
});
router.get('/backups/:id/download', async (req, res) => {
    try {
        const row = await db_1.prisma.dataBackup.findFirstOrThrow({ where: { id: req.params.id, status: 'TAYYOR' } });
        await db_1.prisma.auditLog.create({ data: { userId: req.user.id, action: 'BACKUP_DOWNLOADED', entity: 'DataBackup', entityId: row.id } });
        res.setHeader('Cache-Control', 'no-store');
        res.attachment(`restoran-${row.id}.encrypted.json`).json({ format: 'choyxona-encrypted-v1', createdAt: row.createdAt, encryptedData: row.encryptedData });
    }
    catch {
        res.status(404).json({ message: 'Tayyor nusxa topilmadi' });
    }
});
router.get('/backups/:id/preview', async (req, res) => {
    try {
        const row = await db_1.prisma.dataBackup.findFirstOrThrow({ where: { id: req.params.id, status: 'TAYYOR' } });
        const snapshot = JSON.parse((0, secrets_1.decryptSecret)(row.encryptedData));
        res.json({ createdAt: snapshot.createdAt, settings: snapshot.settings, manifest: row.manifest });
    }
    catch {
        res.status(400).json({ message: 'Nusxani tekshirib bo‘lmadi' });
    }
});
router.post('/backups/:id/restore-settings', async (req, res) => {
    const keys = req.body?.keys;
    if (req.body?.confirmation !== 'SOZLAMALARNI TIKLASH' || !Array.isArray(keys) || !keys.length || keys.some(key => !['restaurant', 'payments', 'orders', 'alerts', 'telegramReport', 'waiterService', 'kitchenTv'].includes(key))) {
        res.status(400).json({ message: 'Tiklanadigan sozlamalarni tanlang va tasdiqlash matnini kiriting' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`;
            const row = await tx.dataBackup.findFirstOrThrow({ where: { id: req.params.id, status: 'TAYYOR' } });
            const snapshot = JSON.parse((0, secrets_1.decryptSecret)(row.encryptedData));
            if (snapshot.format !== 'choyxona-business-v1')
                throw Error();
            for (const key of new Set(keys))
                await (0, settings_1.saveSettings)(tx, key, snapshot.settings[key], req.user.id);
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'BACKUP_SETTINGS_RESTORED', entity: 'DataBackup', entityId: row.id, newValue: JSON.stringify({ keys }) } });
        }, { timeout: 30000 });
        (0, socket_1.emitSocketEvent)('settings_updated', {});
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Sozlamalarni tiklab bo‘lmadi' });
    }
});
router.get('/export/:kind', async (req, res) => {
    try {
        const from = new Date(String(req.query.from)), to = new Date(String(req.query.to));
        if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 93 * 86400000) {
            res.status(400).json({ message: 'Eksport davri 93 kundan oshmasin' });
            return;
        }
        const where = { createdAt: { gte: from, lte: to } };
        let data;
        if (req.params.kind === 'payments')
            data = await db_1.prisma.payment.findMany({ where, take: 50001, select: { id: true, orderId: true, amount: true, method: true, createdAt: true } });
        else if (req.params.kind === 'inventory')
            data = await db_1.prisma.inventoryTransaction.findMany({ where, take: 50001, select: { inventoryId: true, quantityChange: true, quantityBefore: true, quantityAfter: true, type: true, reason: true, createdAt: true } });
        else {
            res.status(404).json({ message: 'Eksport turi topilmadi' });
            return;
        }
        if (data.length > 50000) {
            res.status(400).json({ message: 'Eksport juda katta. Davrni qisqartiring' });
            return;
        }
        await db_1.prisma.auditLog.create({ data: { userId: req.user.id, action: 'DATA_EXPORTED', entity: 'DataExport', newValue: JSON.stringify({ kind: req.params.kind, from, to, count: data.length }) } });
        res.setHeader('Cache-Control', 'no-store');
        res.attachment(`restoran-${req.params.kind}.json`).json(data);
    }
    catch {
        res.status(500).json({ message: 'Eksport bajarilmadi' });
    }
});
router.post('/archive', async (req, res) => {
    const before = new Date(req.body?.before);
    if (!Number.isFinite(before.getTime()) || before > new Date() || typeof req.body?.restore !== 'boolean') {
        res.status(400).json({ message: 'Arxiv sanasi yoki amali noto‘g‘ri' });
        return;
    }
    try {
        const count = await db_1.prisma.$transaction(async (tx) => {
            const result = await tx.order.updateMany({ where: { createdAt: { lt: before }, status: { in: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'] }, OR: [{ debt: { is: null } }, { debt: { remaining: { equals: 0 } } }] }, data: { archivedAt: req.body.restore ? null : new Date() } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: req.body.restore ? 'ORDERS_UNARCHIVED' : 'ORDERS_ARCHIVED', entity: 'Order', newValue: JSON.stringify({ before, count: result.count }) } });
            return result.count;
        });
        res.json({ count });
    }
    catch {
        res.status(400).json({ message: 'Arxiv amali bajarilmadi' });
    }
});
exports.default = router;
