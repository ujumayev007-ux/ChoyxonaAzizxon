import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../models'; // PrismaClient instansiyasi (prisma)
import { emitSocketEvent } from '../socket';

const router = Router();

// Helper: Secure Telegram WebApp Hash Validation
function validateTelegramWebAppData(initData: string, botToken: string): any {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `${key}=${val}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

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
        if (!message || !message.text) return res.sendStatus(200);

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
    } catch (error) {
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
        } catch (e) {
            return res.status(401).json({ success: false, message: "Telegram sessiyasi yaroqsiz" });
        }

        if (!telegramUser || !telegramUser.id) {
            return res.status(401).json({ success: false, message: "Telegram sessiyasi yaroqsiz" });
        }

        let validatedTableId = tableId;
        if (validatedTableId) {
            const table = await db.table.findUnique({ where: { id: validatedTableId } });
            if (!table || !table.isActive) {
                return res.status(400).json({ success: false, message: "Stol faol emas yoki topilmadi" });
            }
        } else {
            return res.status(400).json({ success: false, message: "Stol ma’lumoti topilmadi" });
        }

        // Prisma orqali customer topish yoki yaratish
        let customer = await db.customer.findUnique({
            where: { telegramId: String(telegramUser.id) }
        });

        if (!customer) {
            customer = await db.customer.create({
                data: {
                    telegramId: String(telegramUser.id),
                    firstName: telegramUser.first_name || '',
                    lastName: telegramUser.last_name || '',
                    username: telegramUser.username || ''
                }
            });
        }

        res.json({
            success: true,
            data: {
                customer: { id: customer.id, firstName: customer.firstName },
                table: { id: validatedTableId, name: `Stol #${validatedTableId}` }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server bilan aloqa uzildi" });
    }
});

// 3. Secure Customer Order Creation Endpoint
router.post('/customer/orders', async (req, res) => {
    try {
        const { tableId, items, customerId, notes } = req.body; 

        if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "Buyurtma yuborilmadi" });
        }

        let calculatedTotal = 0;
        const orderItemsData = [];

        for (const cartItem of items) {
            // Prisma da menuItem ishlatiladi
            const dish = await db.menuItem.findUnique({ where: { id: cartItem.dishId } });
            if (!dish) {
                return res.status(400).json({ success: false, message: "Taom topilmadi" });
            }
            const itemTotal = dish.price * cartItem.quantity;
            calculatedTotal += itemTotal;
            orderItemsData.push({
                menuItemId: dish.id,
                quantity: cartItem.quantity,
                price: dish.price
            });
        }

        // Prisma transaksiya orqali buyurtma va uning elementlarini yaratish
        const order = await db.$transaction(async (prisma: any) => {
            const newOrder = await prisma.order.create({
                data: {
                    tableId,
                    customerId,
                    totalAmount: calculatedTotal,
                    status: 'pending',
                    notes: notes || ''
                }
            });

            for (const itemData of orderItemsData) {
                await prisma.orderItem.create({
                    data: {
                        orderId: newOrder.id,
                        ...itemData
                    }
                });
            }

            return newOrder;
        });

        emitSocketEvent('waiter_new_order', { orderId: order.id, tableId, totalAmount: calculatedTotal });

        res.json({
            success: true,
            message: "Buyurtmangiz yuborildi, ofitsiant tez orada kelib tasdiqlaydi",
            data: { orderId: order.id, tableId, totalAmount: calculatedTotal }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server bilan aloqa uzildi" });
    }
});

export default router;
