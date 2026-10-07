"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const express_1 = require("express");
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
function validateTelegramWebAppData(initData, botToken) {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash || !/^[a-f\d]{64}$/i.test(hash))
        return null;
    urlParams.delete('hash');
    const authDate = Number(urlParams.get('auth_date'));
    if (!Number.isInteger(authDate) || Date.now() / 1000 - authDate > 24 * 60 * 60 || authDate > Date.now() / 1000 + 60) {
        return null;
    }
    const dataCheckString = Array.from(urlParams.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = (0, crypto_1.createHmac)('sha256', 'WebAppData').update(botToken).digest();
    const calculated = (0, crypto_1.createHmac)('sha256', secretKey).update(dataCheckString).digest();
    const received = Buffer.from(hash, 'hex');
    if (calculated.length !== received.length || !(0, crypto_1.timingSafeEqual)(calculated, received))
        return null;
    try {
        const userValue = JSON.parse(urlParams.get('user') || 'null');
        if (!userValue || typeof userValue !== 'object' || !Number.isSafeInteger(userValue.id))
            return null;
        return userValue;
    }
    catch {
        return null;
    }
}
function orderNumber() {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
        .format(new Date()).replace(/-/g, '');
    return `${date}-${(0, crypto_1.randomBytes)(4).toString('hex').toUpperCase()}`;
}
router.post('/webhook', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.text)
            return res.sendStatus(200);
        if (!process.env.TELEGRAM_BOT_TOKEN)
            return res.sendStatus(503);
        const chatId = message.chat.id;
        const webAppUrl = process.env.CUSTOMER_WEB_APP_URL;
        if (typeof webAppUrl !== 'string' || !webAppUrl) {
            res.sendStatus(503);
            return;
        }
        if (message.text.startsWith('/start')) {
            const startParam = String(message.text).split(' ')[1] || '';
            const appUrl = new URL(webAppUrl);
            if (startParam.startsWith('table_'))
                appUrl.searchParams.set('table', startParam.slice('table_'.length));
            const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: 'Assalomu alaykum! ChoyxonaAzizxon restoraniga xush kelibsiz.\n\nBuyurtma berish uchun menyuni oching.',
                    reply_markup: { inline_keyboard: [[{ text: '🍽 Menyuni ochish', web_app: { url: appUrl.toString() } }]] }
                })
            });
            if (!telegramResponse.ok) {
                console.error('Telegram /start javobi yuborilmadi:', await telegramResponse.text());
                res.sendStatus(502);
                return;
            }
        }
        res.sendStatus(200);
    }
    catch (error) {
        console.error('Telegram webhook xatoligi:', error);
        res.sendStatus(500);
    }
});
router.post('/customer/telegram/auth', async (req, res) => {
    const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
    const tableId = typeof req.body?.tableId === 'string' ? req.body.tableId : '';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!initData || !botToken || !tableId) {
        res.status(400).json({ success: false, message: 'Telegram sessiyasi yoki stol ma’lumoti yetishmaydi' });
        return;
    }
    const telegramUser = validateTelegramWebAppData(initData, botToken);
    if (!telegramUser) {
        res.status(401).json({ success: false, message: 'Telegram sessiyasi yaroqsiz yoki muddati tugagan' });
        return;
    }
    try {
        const table = await db_1.prisma.table.findFirst({
            where: { id: tableId, isActive: true, room: { isActive: true } },
            select: { id: true, number: true }
        });
        if (!table) {
            res.status(400).json({ success: false, message: 'Stol faol emas yoki topilmadi' });
            return;
        }
        const firstName = telegramUser.first_name || '';
        const lastName = telegramUser.last_name || '';
        const phoneDigits = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
        const customer = await db_1.prisma.customer.upsert({
            where: { telegramId: String(telegramUser.id) },
            create: {
                telegramId: String(telegramUser.id),
                firstName,
                lastName,
                ...(telegramUser.username ? { username: telegramUser.username } : {}),
                ...(phoneDigits ? { phone: String(req.body.phone).trim(), phoneDigits } : {})
            },
            update: {
                firstName,
                lastName,
                ...(telegramUser.username ? { username: telegramUser.username } : {}),
                ...(phoneDigits ? { phone: String(req.body.phone).trim(), phoneDigits } : {})
            },
            select: { id: true, firstName: true, lastName: true, customerNumber: true }
        });
        res.json({
            success: true,
            data: { customer, table: { id: table.id, name: `Stol #${table.number}` } }
        });
    }
    catch (error) {
        console.error('Telegram mijozini autentifikatsiya qilishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Telegram orqali kirishda xatolik yuz berdi' });
    }
});
router.post('/customer/orders', async (req, res) => {
    const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramUser = initData && botToken ? validateTelegramWebAppData(initData, botToken) : null;
    if (!telegramUser) {
        res.status(401).json({ success: false, message: 'Telegram sessiyasi yaroqsiz yoki muddati tugagan' });
        return;
    }
    const tableId = typeof req.body?.tableId === 'string' ? req.body.tableId : '';
    const items = req.body?.items;
    if (!tableId || !Array.isArray(items) || !items.length || items.length > 100 ||
        items.some(item => !item || typeof item.dishId !== 'string' ||
            !/^\d{1,10}(?:\.\d{1,6})?$/.test(String(item.quantity)) || Number(item.quantity) <= 0)) {
        res.status(400).json({ success: false, message: 'Buyurtma ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const table = await db_1.prisma.table.findFirst({
            where: { id: tableId, isActive: true, room: { isActive: true } },
            select: { id: true, roomId: true, number: true }
        });
        const customer = await db_1.prisma.customer.findUnique({ where: { telegramId: String(telegramUser.id) }, select: { id: true } });
        if (!table || !customer) {
            res.status(400).json({ success: false, message: 'Stol yoki mijoz topilmadi' });
            return;
        }
        const menuIds = [...new Set(items.map(item => item.dishId))];
        const menu = await db_1.prisma.menuItem.findMany({
            where: { id: { in: menuIds }, isActive: true, category: { isActive: true } },
            select: { id: true, sellingPrice: true }
        });
        if (menu.length !== menuIds.length) {
            res.status(400).json({ success: false, message: 'Buyurtmadagi taom topilmadi yoki faol emas' });
            return;
        }
        const menuById = new Map(menu.map(item => [item.id, item]));
        const orderItems = items.map(item => {
            const dish = menuById.get(item.dishId);
            const quantity = new client_1.Prisma.Decimal(String(item.quantity));
            const unitPrice = new client_1.Prisma.Decimal(dish.sellingPrice);
            return { menuItemId: dish.id, quantity, unitPrice, totalPrice: quantity.mul(unitPrice) };
        });
        const total = orderItems.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0));
        const order = await db_1.prisma.order.create({
            data: {
                orderNumber: orderNumber(),
                tableId: table.id,
                customerId: customer.id,
                source: client_1.OrderSource.CUSTOMER_WEB,
                orderType: client_1.OrderType.DINE_IN,
                status: client_1.OrderStatus.YANGI,
                subtotal: total,
                totalAmount: total,
                ...(typeof req.body?.notes === 'string' && req.body.notes.trim()
                    ? { notes: req.body.notes.trim().slice(0, 500) } : {}),
                items: { create: orderItems },
                statusHistory: { create: { status: client_1.OrderStatus.YANGI, comment: 'Customer Web App' } }
            },
            select: { id: true, orderNumber: true, totalAmount: true, status: true, source: true }
        });
        (0, socket_1.emitSocketEvent)('waiter_new_order', { orderId: order.id, tableId, totalAmount: total.toString() });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: order.id, tableId, roomId: table.roomId, status: order.status, source: order.source });
        (0, socket_1.emitSocketEvent)('table_status_updated', { tableId, roomId: table.roomId });
        res.status(201).json({
            success: true,
            message: 'Buyurtmangiz yuborildi, ofitsiant tez orada kelib tasdiqlaydi',
            data: { orderId: order.id, orderNumber: order.orderNumber, tableId, totalAmount: order.totalAmount }
        });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Buyurtma raqami to‘qnashdi, qayta yuboring' });
            return;
        }
        console.error('Telegram Web App buyurtmasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmani yuborib bo‘lmadi' });
    }
});
exports.default = router;
