"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const settings_1 = require("../utils/settings");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
router.get('/health', async (_req, res) => {
    try {
        const [printer, telegram, backup, printConfig, token, printerSuccess, printerFailure, telegramSuccess, telegramFailure, backupSuccess, backupFailure] = await Promise.all([
            db_1.prisma.printJob.findFirst({ where: { jobType: { in: ['KITCHEN', 'TEST'] } }, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true } }),
            db_1.prisma.telegramDelivery.findFirst({ orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true } }),
            db_1.prisma.dataBackup.findFirst({ orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true } }),
            db_1.prisma.printConfig.findUnique({ where: { id: 'default' }, select: { agentTokenHash: true } }),
            db_1.prisma.appSetting.findUnique({ where: { key: 'telegramSecret' }, select: { key: true } }),
            db_1.prisma.printJob.findFirst({ where: { jobType: { in: ['KITCHEN', 'TEST'] }, status: 'YUBORILDI' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            db_1.prisma.printJob.findFirst({ where: { jobType: { in: ['KITCHEN', 'TEST'] }, status: 'XATOLIK' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            db_1.prisma.telegramDelivery.findFirst({ where: { status: 'YUBORILDI' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            db_1.prisma.telegramDelivery.findFirst({ where: { status: 'XATOLIK' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            db_1.prisma.dataBackup.findFirst({ where: { status: 'TAYYOR' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            db_1.prisma.dataBackup.findFirst({ where: { status: 'XATOLIK' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
        ]);
        res.json({ checkedAt: new Date(), printer: { configured: Boolean(printConfig?.agentTokenHash), last: printer, lastSuccess: printerSuccess, lastFailure: printerFailure }, telegram: { configured: Boolean(token || process.env.TELEGRAM_BOT_TOKEN), last: telegram, lastSuccess: telegramSuccess, lastFailure: telegramFailure }, backup: { last: backup, lastSuccess: backupSuccess, lastFailure: backupFailure } });
    }
    catch {
        res.status(503).json({ message: 'Xizmatlar holatini olib bo‘lmadi. Qayta tekshiring.' });
    }
});
router.get('/alerts', async (_req, res) => {
    try {
        res.json(await db_1.prisma.systemAlert.findMany({ where: { resolvedAt: null }, take: 100, orderBy: { createdAt: 'desc' } }));
    }
    catch {
        res.status(500).json({ message: 'Ogohlantirishlar yuklanmadi' });
    }
});
router.post('/alerts/:id/resolve', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.systemAlert.update({ where: { id: req.params.id }, data: { resolvedAt: new Date() } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'ALERT_ACKNOWLEDGED', entity: 'SystemAlert', entityId: req.params.id } });
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Ogohlantirish yopilmadi' });
    }
});
router.get('/', async (_req, res) => {
    try {
        const data = Object.fromEntries(await Promise.all(Object.keys(settings_1.defaults).map(async (key) => [key, await (0, settings_1.getSettings)(db_1.prisma, key)])));
        res.json({ ...data, _versions: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, (0, settings_1.settingsVersion)(value)])) });
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
        let version = '';
        await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`;
            const expected = req.get('x-settings-version');
            if (expected && expected !== (0, settings_1.settingsVersion)(await (0, settings_1.getSettings)(tx, req.params.key)))
                throw Error('SETTINGS_CONFLICT');
            const revision = await (0, settings_1.saveSettings)(tx, req.params.key, req.body, req.user.id);
            version = (0, settings_1.settingsVersion)(revision.value);
        }, { timeout: 30000 });
        (0, socket_1.emitSocketEvent)('settings_updated', { key: req.params.key });
        res.json({ success: true, version });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'SETTINGS_CONFLICT') {
            res.status(409).json({ message: 'Boshqa admin bu sozlamalarni o‘zgartirdi. Yangilab, o‘zgarishlaringizni qayta tekshiring.' });
            return;
        }
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
            const expected = req.get('x-settings-version');
            if (expected && expected !== (0, settings_1.settingsVersion)(await (0, settings_1.getSettings)(tx, revision.key)))
                throw Error('SETTINGS_CONFLICT');
            await (0, settings_1.saveSettings)(tx, revision.key, revision.previous, req.user.id);
        }, { timeout: 30000 });
        (0, socket_1.emitSocketEvent)('settings_updated', {});
        res.json({ success: true });
    }
    catch (error) {
        res.status(error instanceof Error && error.message === 'SETTINGS_CONFLICT' ? 409 : 400).json({ message: error instanceof Error && error.message === 'SETTINGS_CONFLICT' ? 'Sozlamalar o‘zgargan. Tarixni yangilab qayta tekshiring.' : 'Oldingi sozlamalarni tiklab bo‘lmadi' });
    }
});
exports.default = router;
