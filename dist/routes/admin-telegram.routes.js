"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../utils/db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
const telegramApiBase = 'https://api.telegram.org';
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }
    const res = await fetch(`${telegramApiBase}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Telegram API error: ${res.status} ${body}`);
    }
    const data = (await res.json().catch(() => ({})));
    return Boolean(data.ok);
}
function formatTelegramMessage(title, lines) {
    const safeLines = lines.map(line => line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `<b>${title}</b>\n\n${safeLines.join("\n")}`;
}
router.get('/subscribers', async (_req, res) => {
    try {
        const subscribers = await db_1.prisma.telegramSubscriber.findMany({
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
        });
        res.json({ success: true, data: subscribers });
    }
    catch (error) {
        console.error('Failed to fetch Telegram subscribers:', error);
        res.status(500).json({ success: false, message: 'Telegram foydalanuvchilarini yuklab bo\'lmadi' });
    }
});
router.post('/subscribers', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const username = typeof req.body?.username === 'string' && req.body.username.trim() ? req.body.username.trim() : null;
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';
    const isActive = req.body?.isActive !== false;
    if (!name || name.length < 2 || name.length > 100) {
        res.status(400).json({ success: false, message: 'Ism 2РІР‚вЂњ100 belgidan iborat bo\'lishi kerak' });
        return;
    }
    if (!chatId || chatId.length < 1 || chatId.length > 50) {
        res.status(400).json({ success: false, message: 'Chat ID noto\'g\'ri' });
        return;
    }
    if (username && (username.length > 50 || !/^@?[A-Za-z0-9_]{1,50}$/.test(username))) {
        res.status(400).json({ success: false, message: 'Telegram username noto\'g\'ri' });
        return;
    }
    try {
        const subscriber = await db_1.prisma.telegramSubscriber.create({
            data: {
                name,
                username: username ? (username.startsWith('@') ? username : `@${username}`) : null,
                chatId,
                isActive
            }
        });
        res.status(201).json({ success: true, message: 'Telegram foydalanuvchisi qo\'shildi.', data: subscriber });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu Chat ID allaqachon ro\'yxatda mavjud' });
            return;
        }
        console.error('Failed to create Telegram subscriber:', error);
        res.status(500).json({ success: false, message: 'Telegram foydalanuvchisini qo\'shib bo\'lmadi' });
    }
});
router.put('/subscribers/:id', async (req, res) => {
    const id = req.params.id;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : null;
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : undefined;
    const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;
    if (name !== undefined && (name.length < 2 || name.length > 100)) {
        res.status(400).json({ success: false, message: 'Ism 2РІР‚вЂњ100 belgidan iborat bo\'lishi kerak' });
        return;
    }
    if (chatId !== undefined && (chatId.length < 1 || chatId.length > 50)) {
        res.status(400).json({ success: false, message: 'Chat ID noto\'g\'ri' });
        return;
    }
    if (username !== null && username && (username.length > 50 || !/^@?[A-Za-z0-9_]{1,50}$/.test(username))) {
        res.status(400).json({ success: false, message: 'Telegram username noto\'g\'ri' });
        return;
    }
    try {
        const subscriber = await db_1.prisma.telegramSubscriber.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(username !== undefined ? { username: username ? (username.startsWith('@') ? username : `@${username}`) : null } : {}),
                ...(chatId !== undefined ? { chatId } : {}),
                ...(isActive !== undefined ? { isActive } : {})
            }
        });
        res.json({ success: true, message: 'Telegram foydalanuvchisi yangilandi.', data: subscriber });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu Chat ID allaqachon ro\'yxatda mavjud' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            res.status(404).json({ success: false, message: 'Telegram foydalanuvchisi topilmadi' });
            return;
        }
        console.error('Failed to update Telegram subscriber:', error);
        res.status(500).json({ success: false, message: 'Telegram foydalanuvchisini yangilab bo\'lmadi' });
    }
});
router.delete('/subscribers/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await db_1.prisma.telegramSubscriber.delete({ where: { id } });
        res.json({ success: true, message: 'Telegram foydalanuvchisi o\'chirildi.' });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            res.status(404).json({ success: false, message: 'Telegram foydalanuvchisi topilmadi' });
            return;
        }
        console.error('Failed to delete Telegram subscriber:', error);
        res.status(500).json({ success: false, message: 'Telegram foydalanuvchisini o\'chirib bo\'lmadi' });
    }
});
router.post('/subscribers/:id/test', async (req, res) => {
    const id = req.params.id;
    try {
        const subscriber = await db_1.prisma.telegramSubscriber.findUnique({ where: { id } });
        if (!subscriber) {
            res.status(404).json({ success: false, message: 'Telegram foydalanuvchisi topilmadi' });
            return;
        }
        if (!subscriber.isActive) {
            res.status(400).json({ success: false, message: 'Foydalanuvchi aktiv emas' });
            return;
        }
        const success = await sendTelegramMessage(subscriber.chatId, formatTelegramMessage('Sinov xabari', ['Bu ChoyxonaAzizxon tizimidan yuborilgan sinov xabaridir.']));
        if (success) {
            res.json({ success: true, message: 'Xabar yuborildi.' });
        }
        else {
            res.status(502).json({ success: false, message: 'Telegram xabarini yuborishda xatolik yuz berdi' });
        }
    }
    catch (error) {
        console.error('Failed to send test Telegram message:', error);
        const message = error instanceof Error && error.message.includes('TELEGRAM_BOT_TOKEN')
            ? 'Telegram bot token sozlanmagan'
            : 'Telegram xabarini yuborishda xatolik yuz berdi';
        res.status(502).json({ success: false, message });
    }
});
exports.default = router;
