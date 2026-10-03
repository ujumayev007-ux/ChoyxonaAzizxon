"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const telegraf_1 = require("telegraf");
// 1. Muhit o'zgaruvchilarini eng boshida yuklash
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const prisma = new client_1.PrismaClient();
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
}));
app.use(express_1.default.json());
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});
// ==========================================
// 2. TELEGRAM BOT (Telegraf)
// ==========================================
const bot = new telegraf_1.Telegraf('8988086533:AAE3R-n4epHKRASk_8hCO-vvX-nnk-OckEc');
bot.start((ctx) => {
    // @ts-ignore
    const startPayload = ctx.startPayload;
    let webAppUrl = 'https://choyxonaazizxon.onrender.com/customer/';
    if (startPayload && typeof startPayload === 'string' && startPayload.startsWith('table_')) {
        const tableNumber = startPayload.replace('table_', '');
        webAppUrl = `https://choyxonaazizxon.onrender.com/customer/?table=${tableNumber}`;
    }
    ctx.reply('Assalomu alaykum! "ChoyxonaAzizxon" restoraniga xush kelibsiz. Marhamat, quyidagi tugmani bosib menyuni oching:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🍽 Menyuni ochish', web_app: { url: webAppUrl } }]
            ]
        }
    });
});
bot.launch().then(() => {
    console.log('Telegram bot muvaffaqiyatli ishga tushdi!');
}).catch((err) => {
    console.error('Botni ishga tushirishda xatolik:', err);
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
// ==========================================
// 3. ADMIN PANEL VA API ROUTELARI
// ==========================================
// Xonalar va stollar
app.get('/api/rooms', async (req, res) => {
    try {
        const rooms = await prisma.room.findMany({
            include: { tables: true }
        });
        res.json(rooms);
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Xonalarni olishda xatolik" });
    }
});
app.post('/api/rooms', async (req, res) => {
    try {
        const { name } = req.body;
        const room = await prisma.room.create({ data: { name } });
        res.json({ success: true, data: room });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Xona qo'shilmadi" });
    }
});
app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.table.deleteMany({ where: { roomId: id } });
        await prisma.room.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Xonani o'chirib bo'lmadi" });
    }
});
app.post('/api/tables', async (req, res) => {
    try {
        const { number, roomId } = req.body;
        const qrCodeToken = `table_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const table = await prisma.table.create({
            data: {
                number: String(number),
                roomId: String(roomId),
                qrCodeToken: qrCodeToken
            }
        });
        res.json({ success: true, data: table });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Stol qo'shilmadi" });
    }
});
app.delete('/api/tables/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.table.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Stolni o'chirib bo'lmadi" });
    }
});
// Menyu va tannarx
app.get('/api/menu', async (req, res) => {
    try {
        const menuItems = await prisma.menuItem.findMany({
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        res.json(menuItems);
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Menyuni olib kelishda xatolik" });
    }
});
// Omborxona
app.get('/api/inventory', async (req, res) => {
    try {
        const products = await prisma.inventoryProduct.findMany();
        res.json(products);
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Ombor ma'lumotlarini olishda xatolik" });
    }
});
// Xodimlar
app.get('/api/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            include: { waiterProfile: true, cashierProfile: true }
        });
        res.json(users);
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Xodimlarni olishda xatolik" });
    }
});
// Buyurtmalar
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            include: { table: true, waiter: true, items: { include: { menuItem: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders);
    }
    catch (error) {
        res.status(500).json({ success: false, message: "Buyurtmalarni olishda xatolik" });
    }
});
// Ofitsiantni chaqirish Socket.io orqali
io.on('connection', (socket) => {
    console.log('Foydalanuvchi ulandi:', socket.id);
    socket.on('call_waiter', async (data) => {
        io.emit('orderUpdate', data);
    });
    socket.on('disconnect', () => {
        console.log('Foydalanuvchi uzildi:', socket.id);
    });
});
// ==========================================
// 4. SERVERNI ISHGA TUSHIRISH
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishga tushdi!`);
});
