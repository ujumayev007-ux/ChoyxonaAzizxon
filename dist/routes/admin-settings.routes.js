"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const settings_1 = require("../utils/settings");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
router.get('/', async (_req, res) => {
    try {
        res.json(Object.fromEntries(await Promise.all(Object.keys(settings_1.defaults).map(async (key) => [key, await (0, settings_1.getSettings)(db_1.prisma, key)]))));
    }
    catch {
        res.status(500).json({ message: 'Sozlamalar yuklanmadi' });
    }
});
router.put('/:key', async (req, res) => {
    if (req.params.key === 'telegramReport' || !Object.hasOwn(settings_1.defaults, req.params.key)) {
        res.status(404).json({ message: 'Sozlama topilmadi' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => { await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`; await (0, settings_1.saveSettings)(tx, req.params.key, req.body, req.user.id); }, { timeout: 30000 });
        (0, socket_1.emitSocketEvent)('settings_updated', { key: req.params.key });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Sozlama qiymatlari noto‘g‘ri yoki saqlashda xatolik' });
    }
});
router.get('/history', async (_req, res) => {
    try {
        const rows = await db_1.prisma.settingRevision.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
        const actors = await db_1.prisma.user.findMany({ where: { id: { in: rows.map(row => row.actorId) } }, select: { id: true, fullName: true } });
        res.json(rows.map(row => ({ ...row, actorName: actors.find(actor => actor.id === row.actorId)?.fullName })));
    }
    catch {
        res.status(500).json({ message: 'Sozlamalar tarixi yuklanmadi' });
    }
});
router.post('/history/:id/restore', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`;
            const revision = await tx.settingRevision.findUniqueOrThrow({ where: { id: req.params.id } });
            if (revision.key === 'telegramReport' || !Object.hasOwn(settings_1.defaults, revision.key))
                throw Error();
            await (0, settings_1.saveSettings)(tx, revision.key, revision.previous, req.user.id);
        }, { timeout: 30000 });
        (0, socket_1.emitSocketEvent)('settings_updated', {});
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Oldingi sozlamalarni tiklab bo‘lmadi' });
    }
});
exports.default = router;
