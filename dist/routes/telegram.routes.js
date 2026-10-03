"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const models_1 = require("../models");
const socket_1 = require("../socket");
// TypeScript tur tekshiruvini chetlab o'tib, Sequelize ishlashini ta'minlaymiz
const db = models_1.db;
const router = (0, express_1.Router)();
// Helper: Secure Telegram WebApp Hash Validation
function validateTelegramWebAppData(initData, botToken) {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    const dataCheckString = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `${key}=${val}`)
        .join('\n');
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) {
        throw new Error('Invalid Telegram hash');
    }
    const userParam = urlParams.get('user');
    return userParam ? JSON.parse(userParam) : null;
}
// 1. Telegram Bot Webhook Endpoint
router.post('/webhook', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.text)
            return res.sendStatus(200);
        const chatId = message.chat.id;
        const text = message.text;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const webAppUrl = process.env.CUSTOMER_WEB_APP_URL;
        if (text.startsWith('/start')) {
            const parts = text.split(' ');
            let startParam = parts.length > 1 ? parts[1] : '';
            let appUrlWithParam = webAppUrl;
            if (startParam.startsWith('table_')) {
                appUrlWithParam = `${webAppUrl}?table=${startParam.replace('table_', '')}`;
            }
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "Assalomu alaykum! ChoyxonaAzizxon restoraniga xush kelibsiz.\n\nBuyurtma berish uchun menyuni oching.",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🍽 Menyuni ochish", web_app: { url: appUrlWithParam } }]
                        ]
                    }
                })
            });
        }
        res.sendStatus(200);
    }
    catch (error) {
        res.sendStatus(500);
    }
});
// 2. Telegram WebApp Authentication & Session Endpoint
router.post('/customer/telegram/auth', async (req, res) => {
    try {
        const { initData, tableId } = req.body;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!initData || !botToken) {
            return res.status(400).json({ success: false, message: "Telegram orqali autentifikatsiya qilishda xatolik yuz berdi" });
        }
        let telegramUser;
        try {
            telegramUser = validateTelegramWebAppData(initData, botToken);
        }
        catch (e) {
            return res.status(401).json({ success: false, message: "Telegram sessiyasi yaroqsiz" });
        }
        if (!telegramUser || !telegramUser.id) {
            return res.status(401).json({ success: false, message: "Telegram sessiyasi yaroqsiz" });
        }
        let validatedTableId = tableId;
        if (validatedTableId) {
            const table = await db.Table.findByPk(validatedTableId);
            if (!table || !table.isActive) {
                return res.status(400).json({ success: false, message: "Stol faol emas yoki topilmadi" });
            }
        }
        else {
            return res.status(400).json({ success: false, message: "Stol ma’lumoti topilmadi" });
        }
        let customer = await db.Customer.findOne({
            where: { telegramId: String(telegramUser.id) }
        });
        if (!customer) {
            customer = await db.Customer.create({
                telegramId: String(telegramUser.id),
                firstName: telegramUser.first_name || '',
                lastName: telegramUser.last_name || '',
                username: telegramUser.username || ''
            });
        }
        res.json({
            success: true,
            data: {
                customer: { id: customer.id, firstName: customer.firstName },
                table: { id: validatedTableId, name: `Stol #${validatedTableId}` }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Server bilan aloqa uzildi" });
    }
});
// 3. Secure Customer Order Creation Endpoint
router.post('/customer/orders', async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const { tableId, items, customerId, notes } = req.body;
        if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: "Buyurtma yuborilmadi" });
        }
        let calculatedTotal = 0;
        const orderItemsData = [];
        for (const cartItem of items) {
            const dish = await db.MenuItem.findByPk(cartItem.dishId);
            if (!dish) {
                await t.rollback();
                return res.status(400).json({ success: false, message: "Taom topilmadi" });
            }
            const dishPrice = Number(dish.sellingPrice) || 0;
            const itemTotal = dishPrice * cartItem.quantity;
            calculatedTotal += itemTotal;
            orderItemsData.push({
                menuItemId: dish.id,
                quantity: cartItem.quantity,
                price: dishPrice
            });
        }
        const newOrder = await db.Order.create({
            tableId,
            customerId,
            totalAmount: calculatedTotal,
            status: 'pending',
            notes: notes || ''
        }, { transaction: t });
        for (const itemData of orderItemsData) {
            await db.OrderItem.create({
                orderId: newOrder.id,
                ...itemData
            }, { transaction: t });
        }
        await t.commit();
        (0, socket_1.emitSocketEvent)('waiter_new_order', { orderId: newOrder.id, tableId, totalAmount: calculatedTotal });
        res.json({
            success: true,
            message: "Buyurtmangiz yuborildi, ofitsiant tez orada kelib tasdiqlaydi",
            data: { orderId: newOrder.id, tableId, totalAmount: calculatedTotal }
        });
    }
    catch (error) {
        await t.rollback();
        res.status(500).json({ success: false, message: "Server bilan aloqa uzildi" });
    }
});
exports.default = router;
