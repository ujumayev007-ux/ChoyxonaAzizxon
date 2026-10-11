"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const auth_1 = require("../middleware/auth");
const admin_pin_1 = require("../middleware/admin-pin");
const db_1 = require("../utils/db");
const secrets_1 = require("../utils/secrets");
const telegram_1 = require("../utils/telegram");
const settings_1 = require("../utils/settings");
const telegram_reports_1 = require("../utils/telegram-reports");
const telegram_bot_1 = require("../utils/telegram-bot");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), admin_pin_1.requireAdminPin);
const safeSubscriber = { id: true, name: true, username: true, chatId: true, isActive: true, verifiedAt: true, createdAt: true };
const hashCode = (id, code) => (0, crypto_1.createHash)('sha256').update(`${id}:${code}`).digest('hex');
router.get('/report', async (_req, res) => {
    try {
        res.json({ config: await (0, settings_1.getSettings)(db_1.prisma, 'telegramReport'), history: await db_1.prisma.settingRevision.findMany({ where: { key: 'telegramReport' }, take: 30, orderBy: { createdAt: 'desc' } }), runs: await db_1.prisma.scheduledReport.findMany({ take: 50, orderBy: { createdAt: 'desc' } }) });
    }
    catch {
        res.status(500).json({ message: 'Hisobot sozlamalari yuklanmadi' });
    }
});
router.put('/report', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => { await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`; await (0, settings_1.saveSettings)(tx, 'telegramReport', req.body, req.user.id); });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Hisobot ko‘rsatkichlari yoki vaqt noto‘g‘ri' });
    }
});
router.post('/report/restore/:id', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT pg_advisory_xact_lock(72707372)`;
            const revision = await tx.settingRevision.findFirstOrThrow({ where: { id: req.params.id, key: 'telegramReport' } });
            await (0, settings_1.saveSettings)(tx, 'telegramReport', revision.previous, req.user.id);
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Hisobot sozlamalari tiklanmadi' });
    }
});
router.get('/report/preview', async (_req, res) => {
    try {
        res.json({ text: await (0, telegram_reports_1.buildTelegramReport)(new Date(Date.now() - 86400000), new Date()) });
    }
    catch {
        res.status(500).json({ message: 'Hisobot tuzilmadi' });
    }
});
router.get('/config', async (_req, res) => {
    try {
        res.json({ configured: Boolean(await (0, telegram_1.telegramToken)()), encryptionReady: (process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.SESSION_SECRET || '').length >= 32 });
    }
    catch {
        res.status(503).json({ message: 'Bot kalitini ochib bo‘lmadi. Server shifrlash kalitini tekshiring' });
    }
});
router.put('/config', async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) {
        res.status(400).json({ message: 'Bot token formati noto‘g‘ri' });
        return;
    }
    try {
        const encrypted = (0, secrets_1.encryptSecret)(token);
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok || !data.ok)
            throw Error();
        await db_1.prisma.$transaction(async (tx) => {
            await tx.appSetting.upsert({ where: { key: 'telegramSecret' }, create: { key: 'telegramSecret', value: encrypted }, update: { value: encrypted } });
            await tx.telegramSubscriber.updateMany({ data: { verifiedAt: null, verificationHash: null, verificationExpiresAt: null } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'TELEGRAM_BOT_UPDATED', entity: 'AppSetting', entityId: 'telegram', newValue: JSON.stringify({ tokenChanged: true }) } });
        });
        await (0, telegram_bot_1.refreshTelegramBot)();
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Bot tokenini tekshirish yoki saqlash bajarilmadi. Serverda kamida 32 belgili barqaror shifrlash kaliti kerak' });
    }
});
router.get('/subscribers', async (_req, res) => {
    try {
        res.json({ data: await db_1.prisma.telegramSubscriber.findMany({ select: safeSubscriber, orderBy: { createdAt: 'desc' } }) });
    }
    catch {
        res.status(500).json({ message: 'Qabul qiluvchilar yuklanmadi' });
    }
});
router.post('/subscribers', async (req, res) => {
    const { name, chatId } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100 || typeof chatId !== 'string' || !/^\d{1,20}$/.test(chatId)) {
        res.status(400).json({ message: 'Ism va shaxsiy Telegram Chat IDni kiriting' });
        return;
    }
    try {
        const row = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.telegramSubscriber.create({ data: { name: name.trim(), chatId }, select: safeSubscriber });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'TELEGRAM_RECIPIENT_CREATED', entity: 'TelegramSubscriber', entityId: created.id } });
            return created;
        });
        res.status(201).json({ data: row });
    }
    catch {
        res.status(409).json({ message: 'Qabul qiluvchi saqlanmadi. Chat ID takrorlanmasin' });
    }
});
router.put('/subscribers/:id', async (req, res) => {
    if (typeof req.body?.isActive !== 'boolean') {
        res.status(400).json({ message: 'Faollik holatini tanlang' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.telegramSubscriber.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'TELEGRAM_RECIPIENT_UPDATED', entity: 'TelegramSubscriber', entityId: req.params.id, newValue: JSON.stringify({ isActive: req.body.isActive }) } });
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Qabul qiluvchi yangilanmadi' });
    }
});
router.delete('/subscribers/:id', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => {
            await tx.telegramSubscriber.delete({ where: { id: req.params.id } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'TELEGRAM_RECIPIENT_REMOVED', entity: 'TelegramSubscriber', entityId: req.params.id } });
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Qabul qiluvchi o‘chirilmadi' });
    }
});
router.post('/subscribers/:id/code', async (req, res) => {
    try {
        const code = String((0, crypto_1.randomInt)(100000, 1000000));
        const row = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "TelegramSubscriber" WHERE "id"=${req.params.id} FOR UPDATE`;
            const old = await tx.telegramSubscriber.findUniqueOrThrow({ where: { id: req.params.id } });
            if (old.verificationExpiresAt && old.verificationExpiresAt.getTime() > Date.now() + 540000)
                throw Error();
            return tx.telegramSubscriber.update({ where: { id: old.id }, data: { verificationHash: hashCode(old.id, code), verificationExpiresAt: new Date(Date.now() + 600000), verificationAttempts: 0 } });
        });
        await (0, telegram_1.sendTelegramMessage)(row.chatId, `Restoran hisobotlariga ulanish kodi: ${code}. Kodni faqat restoran administratoriga bering. 10 daqiqa amal qiladi.`, 'TASDIQLASH');
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Kod yuborilmadi. Botni shaxsiy chatda ishga tushiring; qayta yuborish oralig‘i 1 daqiqa' });
    }
});
router.post('/subscribers/:id/verify', async (req, res) => {
    if (typeof req.body?.code !== 'string' || !/^\d{6}$/.test(req.body.code)) {
        res.status(400).json({ message: '6 raqamli kodni kiriting' });
        return;
    }
    try {
        const valid = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "TelegramSubscriber" WHERE "id"=${req.params.id} FOR UPDATE`;
            const row = await tx.telegramSubscriber.findUniqueOrThrow({ where: { id: req.params.id } });
            if (!row.verificationHash || !row.verificationExpiresAt || row.verificationExpiresAt < new Date() || row.verificationAttempts >= 5)
                return false;
            if (hashCode(row.id, req.body.code) !== row.verificationHash) {
                await tx.telegramSubscriber.update({ where: { id: row.id }, data: { verificationAttempts: { increment: 1 } } });
                return false;
            }
            await tx.telegramSubscriber.update({ where: { id: row.id }, data: { verifiedAt: new Date(), verificationHash: null, verificationExpiresAt: null } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'TELEGRAM_RECIPIENT_VERIFIED', entity: 'TelegramSubscriber', entityId: row.id } });
            return true;
        });
        res.status(valid ? 200 : 400).json({ success: valid, message: valid ? 'Qabul qiluvchi tasdiqlandi' : 'Kod noto‘g‘ri yoki muddati tugagan' });
    }
    catch {
        res.status(400).json({ message: 'Tasdiqlash bajarilmadi' });
    }
});
router.post('/subscribers/:id/test', async (req, res) => {
    try {
        const row = await db_1.prisma.telegramSubscriber.findFirstOrThrow({ where: { id: req.params.id, isActive: true, verifiedAt: { not: null } } });
        await (0, telegram_1.sendTelegramMessage)(row.chatId, 'Restoran tizimidan sinov xabari.', 'SINOV');
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Sinov yuborilmadi. Qabul qiluvchi tasdiqlangan va faol bo‘lishi kerak' });
    }
});
router.get('/deliveries', async (_req, res) => {
    try {
        res.json(await db_1.prisma.telegramDelivery.findMany({ take: 100, orderBy: { createdAt: 'desc' } }));
    }
    catch {
        res.status(500).json({ message: 'Yuborish tarixi yuklanmadi' });
    }
});
exports.default = router;
