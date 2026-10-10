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
const path_1 = __importDefault(require("path"));
const telegraf_1 = require("telegraf");
const kitchen_routes_1 = __importDefault(require("./routes/kitchen.routes"));
const socket_1 = require("./socket");
const crypto_1 = require("crypto");
const auth_1 = require("./middleware/auth");
const password_1 = require("./utils/password");
const cashier_routes_1 = __importDefault(require("./routes/cashier.routes"));
const menu_routes_1 = __importDefault(require("./routes/menu.routes"));
const admin_reports_routes_1 = __importDefault(require("./routes/admin-reports.routes"));
const order_packaging_1 = require("./utils/order-packaging");
const order_recipes_1 = require("./utils/order-recipes");
const telegram_routes_1 = __importDefault(require("./routes/telegram.routes"));
const admin_telegram_routes_1 = __importDefault(require("./routes/admin-telegram.routes"));
const admin_role_permissions_routes_1 = __importDefault(require("./routes/admin-role-permissions.routes"));
const auth_pin_routes_1 = __importDefault(require("./routes/auth-pin.routes"));
const waiter_orders_routes_1 = __importDefault(require("./routes/waiter-orders.routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const prisma = new client_1.PrismaClient();
async function ensureInitialAdmin() {
    const adminCount = await prisma.user.count({ where: { role: client_1.RoleType.ADMIN } });
    if (adminCount > 0)
        return;
    const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!username && !password) {
        console.warn('No administrator account exists. Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to create the first admin.');
        return;
    }
    if (!username || !password || password.length < 12) {
        console.error('Initial admin provisioning configuration:', {
            usernameExists: Boolean(username),
            passwordExists: typeof password === 'string' && password.length > 0,
            passwordLength: typeof password === 'string' ? password.length : 0
        });
        throw new Error('Set both INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD (at least 12 characters) for initial admin provisioning.');
    }
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
        throw new Error('INITIAL_ADMIN_USERNAME already belongs to a non-admin account.');
    }
    await prisma.user.create({
        data: {
            username,
            passwordHash: await (0, password_1.hashPassword)(password),
            fullName: process.env.INITIAL_ADMIN_FULL_NAME?.trim() || 'Administrator',
            role: client_1.RoleType.ADMIN
        }
    });
    console.log('Initial administrator account created.');
}
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
}));
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
app.get('/kitchen/tv', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'kitchen-tv.html'));
});
// Public papkani statik qilish (sahifalar ochilishi uchun)
app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public')));
app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'favicon.svg'));
});
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});
(0, socket_1.initSocket)(io);
app.use('/api/kitchen', kitchen_routes_1.default);
app.use('/api/admin/reports', admin_reports_routes_1.default);
app.use('/api', telegram_routes_1.default);
app.use('/api/admin/telegram', admin_telegram_routes_1.default);
app.use('/api/admin', admin_role_permissions_routes_1.default);
app.use('/api/auth', auth_pin_routes_1.default);
app.use('/api/waiter/orders', waiter_orders_routes_1.default);
async function loginUser(username, password, allowedRoles) {
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password)
        return null;
    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user || !user.isActive || !allowedRoles.includes(user.role) || !(await (0, password_1.verifyPassword)(password, user.passwordHash))) {
        return null;
    }
    return user;
}
app.get('/api/auth/me', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), (req, res) => {
    res.json({ success: true, user: req.user });
});
app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.username, req.body?.password, [client_1.RoleType.ADMIN]);
        if (!user) {
            res.status(401).json({ success: false, message: 'Login yoki parol noto‘g‘ri' });
            return;
        }
        (0, auth_1.setAuthCookie)(res, user);
        res.json({ success: true, user: { id: user.id, fullName: user.fullName, role: user.role } });
    }
    catch (error) {
        console.error('Admin tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
app.post('/api/auth/logout', auth_1.optionalAuthenticateToken, async (req, res) => {
    if (req.user) {
        try {
            await prisma.$transaction(async (tx) => {
                if (req.user.terminalAccessId) {
                    const access = await tx.adminTerminalAccess.update({
                        where: { id: req.user.terminalAccessId },
                        data: { endedAt: new Date() }
                    });
                    await tx.auditLog.create({
                        data: {
                            userId: access.adminId,
                            action: 'ADMIN_TERMINAL_ACCESS_ENDED',
                            entity: 'AdminTerminalAccess',
                            entityId: access.id,
                            newValue: JSON.stringify({ cashierId: access.cashierId, endedBy: 'AUTH_LOGOUT' })
                        }
                    });
                }
                await tx.user.update({
                    where: { id: req.user.id },
                    data: { updatedAt: new Date(Math.max(Date.now(), (req.user.sessionIssuedAt || 0) + 1)) },
                    select: { id: true }
                });
            });
        }
        catch (error) {
            console.error('Sessiyani bekor qilishda xatolik:', error);
            res.status(500).json({ success: false, message: 'Sessiyani bekor qilib bo‘lmadi' });
            return;
        }
    }
    (0, auth_1.clearTerminalAdminCookie)(res);
    (0, auth_1.clearAuthCookie)(res);
    res.json({ success: true });
});
app.get('/api/waiter/me', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER']), (req, res) => {
    res.json({
        success: true,
        waiter: { id: req.user.id, name: req.user.fullName, login: req.user.username }
    });
});
app.get('/api/waiter/stats', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER']), async (req, res) => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const start = new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day)) - 5 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    try {
        const [orders, waiterProfile] = await Promise.all([
            prisma.order.findMany({
                where: { waiterId: req.user.id, createdAt: { gte: start, lt: end } },
                select: {
                    status: true,
                    payments: { select: { amount: true } },
                    refunds: { select: { amount: true } }
                }
            }),
            prisma.waiterProfile.findUnique({
                where: { userId: req.user.id },
                select: { commissionPercent: true }
            })
        ]);
        const commissionRate = waiterProfile?.commissionPercent || new client_1.Prisma.Decimal(0);
        const completedStatuses = [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI];
        const completedOrders = orders.filter(order => completedStatuses.includes(order.status));
        const cancelledCount = orders.filter(order => order.status === client_1.OrderStatus.BEKOR_QILINDI).length;
        const completedSales = completedOrders.reduce((sum, order) => {
            const paid = order.payments.reduce((total, payment) => total.plus(payment.amount), new client_1.Prisma.Decimal(0));
            const refunded = order.refunds.reduce((total, refund) => total.plus(refund.amount), new client_1.Prisma.Decimal(0));
            return sum.plus(client_1.Prisma.Decimal.max(paid.minus(refunded), new client_1.Prisma.Decimal(0)));
        }, new client_1.Prisma.Decimal(0));
        res.json({
            todayOrdersCount: orders.length,
            todaySales: completedSales.toString(),
            todayCommission: completedSales.mul(commissionRate).dividedBy(100).toString(),
            commissionRate: commissionRate.toString(),
            completedCount: completedOrders.length,
            cancelledCount
        });
    }
    catch (error) {
        console.error('Ofitsiant statistikasini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Statistikani yuklab bo‘lmadi' });
    }
});
app.get('/api/kitchen/session', auth_1.authenticateToken, (0, auth_1.requireRole)(['KITCHEN', 'ADMIN']), (req, res) => {
    res.json({ success: true, user: { id: req.user.id, fullName: req.user.fullName, role: req.user.role } });
});
app.get('/api/kitchen/me', auth_1.authenticateToken, (0, auth_1.requireRole)(['KITCHEN']), (req, res) => {
    res.json({ success: true, user: { id: req.user.id, fullName: req.user.fullName, role: req.user.role } });
});
app.post('/api/kitchen/logout', auth_1.authenticateToken, (0, auth_1.requireRole)(['KITCHEN']), async (req, res) => {
    try {
        await prisma.user.update({
            where: { id: req.user.id },
            data: { updatedAt: new Date(Math.max(Date.now(), (req.user.sessionIssuedAt || 0) + 1)) },
            select: { id: true }
        });
        (0, auth_1.clearAuthCookie)(res);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Oshxona sessiyasidan chiqishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Sessiyadan chiqib bo‘lmadi' });
    }
});
app.post('/api/kitchen/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.username ?? req.body?.login, req.body?.password, [client_1.RoleType.KITCHEN]);
        if (!user) {
            res.status(401).json({ success: false, message: 'Login yoki parol noto‘g‘ri' });
            return;
        }
        (0, auth_1.setAuthCookie)(res, user);
        res.json({ success: true, user: { id: user.id, fullName: user.fullName, role: user.role } });
    }
    catch (error) {
        console.error('Oshxona tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
app.post('/api/waiter/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.login, req.body?.password, [client_1.RoleType.WAITER]);
        if (!user) {
            res.status(401).json({ success: false, error: 'Login yoki parol xato!' });
            return;
        }
        (0, auth_1.setAuthCookie)(res, user);
        res.json({
            success: true,
            waiter: { id: user.id, name: user.fullName, login: user.username }
        });
    }
    catch (error) {
        console.error('Ofitsiant tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
app.get('/api/cashier/me', auth_1.authenticateToken, auth_1.requireCashierAccess, (req, res) => {
    res.json({ success: true, user: req.user });
});
app.post('/api/cashier/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.username, req.body?.password, [client_1.RoleType.CASHIER]);
        if (!user) {
            res.status(401).json({ success: false, message: 'Login yoki parol noto‘g‘ri' });
            return;
        }
        const activeTerminalSessions = await prisma.adminTerminalAccess.findMany({
            where: { cashierId: user.id, endedAt: null },
            select: { id: true, adminId: true }
        });
        if (activeTerminalSessions.length) {
            await prisma.$transaction(async (tx) => {
                await tx.adminTerminalAccess.updateMany({
                    where: { id: { in: activeTerminalSessions.map(access => access.id) }, endedAt: null },
                    data: { endedAt: new Date() }
                });
                await tx.auditLog.createMany({
                    data: activeTerminalSessions.map(access => ({
                        userId: access.adminId,
                        action: 'ADMIN_TERMINAL_ACCESS_ENDED',
                        entity: 'AdminTerminalAccess',
                        entityId: access.id,
                        newValue: JSON.stringify({ cashierId: user.id, endedBy: 'CASHIER_LOGIN' })
                    }))
                });
            });
        }
        (0, auth_1.setAuthCookie)(res, user);
        res.json({ success: true, user: { id: user.id, fullName: user.fullName, role: user.role } });
    }
    catch (error) {
        console.error('Kassir tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
app.use('/api/cashier', cashier_routes_1.default);
app.post('/api/waiter/logout', (_req, res) => {
    (0, auth_1.clearAuthCookie)(res);
    res.json({ success: true });
});
// ==========================================
// 2. TELEGRAM BOT (Telegraf)
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = botToken ? new telegraf_1.Telegraf(botToken) : null;
bot?.start((ctx) => {
    const startPayload = ctx.startPayload;
    const webAppUrl = new URL(process.env.CUSTOMER_WEB_APP_URL || 'https://choyxonaazizxon.onrender.com/customer/');
    if (startPayload?.startsWith('table_')) {
        webAppUrl.searchParams.set('table', startPayload.slice('table_'.length));
    }
    ctx.reply('Assalomu alaykum! "ChoyxonaAzizxon" restoraniga xush kelibsiz. Marhamat, quyidagi tugmani bosib menyuni oching:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🍽 Menyuni ochish', web_app: { url: webAppUrl.toString() } }]
            ]
        }
    });
});
if (bot) {
    bot.launch().then(() => {
        console.log('Telegram bot muvaffaqiyatli ishga tushdi!');
    }).catch((err) => {
        console.error('Botni ishga tushirishda xatolik:', err);
    });
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
else {
    console.warn('TELEGRAM_BOT_TOKEN is not set; Telegram bot is disabled.');
}
// ==========================================
// 3. ADMIN PANEL VA API ROUTELARI
// ==========================================
// Xonalar va stollar
app.get('/api/rooms', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN', 'WAITER', 'CASHIER']), async (req, res) => {
    try {
        const rooms = await prisma.room.findMany({
            where: { isActive: true },
            include: {
                tables: {
                    where: { isActive: true },
                    include: {
                        orders: {
                            where: {
                                status: {
                                    notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI']
                                }
                            },
                            select: { status: true }
                        }
                    }
                }
            }
        });
        res.json(rooms.map(room => ({
            ...room,
            tables: room.tables.map(table => {
                const statuses = table.orders.map(order => order.status);
                const status = statuses.length === 0
                    ? 'AVAILABLE'
                    : statuses.some(value => ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(value))
                        ? 'PENDING'
                        : statuses.includes('TOLOV_KUTILMOQDA') || statuses.includes('QISMAN_TOLANDI')
                            ? 'BILL_REQUESTED'
                            : 'OCCUPIED';
                const { orders, ...tableData } = table;
                return { ...tableData, status };
            })
        })));
    }
    catch (error) {
        console.error('Xonalarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xonalarni olishda xatolik yuz berdi' });
    }
});
app.post('/api/rooms', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name || name.length > 100) {
            res.status(400).json({ success: false, message: 'Xona nomini to‘g‘ri kiriting' });
            return;
        }
        const room = await prisma.room.create({ data: { name } });
        (0, socket_1.emitSocketEvent)('restaurant_structure_updated', { type: 'room_created', roomId: room.id });
        res.json({ success: true, data: room });
    }
    catch (error) {
        console.error('Xona qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xona qo‘shilmadi' });
    }
});
app.delete('/api/rooms/:id', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const { id } = req.params;
        const room = await prisma.room.findUnique({
            where: { id },
            include: {
                tables: {
                    select: {
                        id: true,
                        _count: {
                            select: {
                                orders: {
                                    where: {
                                        status: {
                                            notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI']
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        if (!room) {
            res.status(404).json({ success: false, message: 'Xona topilmadi' });
            return;
        }
        if (room.tables.some(table => table._count.orders > 0)) {
            res.status(409).json({ success: false, message: 'Faol buyurtmalari mavjud xonani o‘chirib bo‘lmaydi' });
            return;
        }
        await prisma.$transaction([
            prisma.room.update({ where: { id }, data: { isActive: false } }),
            prisma.table.updateMany({ where: { roomId: id }, data: { isActive: false } })
        ]);
        (0, socket_1.emitSocketEvent)('restaurant_structure_updated', { type: 'room_deleted', roomId: id });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Xonani o‘chirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xonani o‘chirib bo‘lmadi' });
    }
});
app.post('/api/tables', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const number = typeof req.body?.number === 'string' || typeof req.body?.number === 'number'
        ? String(req.body.number).trim()
        : '';
    const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId.trim() : '';
    if (!number || number.length > 20 || /[\u0000-\u001f]/.test(number) || !roomId) {
        res.status(400).json({ success: false, message: 'Stol raqami va xona ma’lumotini to‘g‘ri kiriting' });
        return;
    }
    if (/^\d+(?:\.\d+)?$/.test(number) && (!Number.isInteger(Number(number)) || Number(number) < 1)) {
        res.status(400).json({ success: false, message: 'Stol raqami musbat butun son bo‘lishi kerak' });
        return;
    }
    try {
        const room = await prisma.room.findFirst({ where: { id: roomId, isActive: true }, select: { id: true } });
        if (!room) {
            res.status(404).json({ success: false, message: 'Xona topilmadi yoki faol emas' });
            return;
        }
        const qrCodeToken = (0, crypto_1.randomBytes)(32).toString('hex');
        const table = await prisma.table.create({
            data: { number, roomId, qrCodeToken }
        });
        (0, socket_1.emitSocketEvent)('restaurant_structure_updated', { type: 'table_created', roomId, tableId: table.id });
        (0, socket_1.emitSocketEvent)('table_status_updated', { roomId, tableId: table.id, status: 'AVAILABLE' });
        res.status(201).json({ success: true, message: 'Stol muvaffaqiyatli qo‘shildi', data: table });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu stol raqami allaqachon mavjud' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'Tanlangan xona mavjud emas' });
            return;
        }
        console.error('Stol qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stol qo‘shishda xatolik yuz berdi' });
    }
});
app.delete('/api/tables/:id', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const { id } = req.params;
        const table = await prisma.table.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        orders: {
                            where: {
                                status: {
                                    notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI']
                                }
                            }
                        }
                    }
                }
            }
        });
        if (!table) {
            res.status(404).json({ success: false, message: 'Stol topilmadi' });
            return;
        }
        if (table._count.orders > 0) {
            res.status(409).json({ success: false, message: 'Faol buyurtmalari mavjud stolni o‘chirib bo‘lmaydi' });
            return;
        }
        await prisma.table.update({ where: { id }, data: { isActive: false } });
        (0, socket_1.emitSocketEvent)('restaurant_structure_updated', { type: 'table_deleted', roomId: table.roomId, tableId: id });
        (0, socket_1.emitSocketEvent)('table_status_updated', { roomId: table.roomId, tableId: id, status: 'DELETED' });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Stolni o‘chirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stolni o‘chirib bo‘lmadi' });
    }
});
app.post('/api/tables/:id/free', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const table = await prisma.table.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!table) {
            res.status(404).json({ success: false, message: 'Stol topilmadi' });
            return;
        }
        const activeOrders = await prisma.order.count({
            where: {
                tableId: table.id,
                status: { notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'] }
            }
        });
        if (activeOrders > 0) {
            res.status(409).json({ success: false, message: 'Faol buyurtmalari bor stolni bo‘shatib bo‘lmaydi' });
            return;
        }
        res.json({ success: true, message: 'Stol bo‘sh' });
    }
    catch (error) {
        console.error('Stol holatini tekshirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stol holatini yangilashda xatolik yuz berdi' });
    }
});
// Menyu va tannarx
app.use('/api/menu', menu_routes_1.default);
// Omborxona
app.get('/api/inventory', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const products = await prisma.inventoryProduct.findMany();
        res.json(products);
    }
    catch (error) {
        console.error('Ombor ma’lumotlarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: "Ombor ma'lumotlarini olishda xatolik" });
    }
});
const createInventoryProduct = async (req, res) => {
    const { name, unit, quantity, minQuantity } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof unit !== 'string' || !unit.trim() ||
        (quantity !== undefined && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0)) ||
        (minQuantity !== undefined && (!Number.isFinite(Number(minQuantity)) || Number(minQuantity) < 0))) {
        res.status(400).json({ success: false, message: 'Ombor mahsuloti ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const product = await prisma.inventoryProduct.create({
            data: {
                name: name.trim(),
                unit: unit.trim(),
                ...(quantity !== undefined ? { quantity: Number(quantity) } : {}),
                ...(minQuantity !== undefined ? { minQuantity: Number(minQuantity) } : {})
            }
        });
        res.status(201).json({ success: true, data: product });
    }
    catch (error) {
        console.error('Ombor mahsulotini qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Ombor mahsuloti qo‘shilmadi' });
    }
};
app.post('/api/inventory', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), createInventoryProduct);
app.post('/api/warehouse', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), createInventoryProduct);
app.get('/api/purchases', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (_req, res) => {
    try {
        const purchases = await prisma.purchase.findMany({
            include: {
                user: { select: { id: true, fullName: true, username: true } },
                items: {
                    include: {
                        inventory: { select: { id: true, name: true, unit: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(purchases);
    }
    catch (error) {
        console.error('Bozorlik tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Bozorlik tarixini olib bo‘lmadi' });
    }
});
app.post('/api/purchases', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const submittedItems = req.body?.items;
    if (!Array.isArray(submittedItems) || submittedItems.length === 0 || submittedItems.length > 100) {
        res.status(400).json({ success: false, message: 'Bozorlik uchun mahsulotlarni kiriting' });
        return;
    }
    const parsedItems = [];
    const inventoryIds = new Set();
    let totalAmount = 0n;
    for (const submittedItem of submittedItems) {
        if (!submittedItem || typeof submittedItem !== 'object') {
            res.status(400).json({ success: false, message: 'Bozorlik mahsuloti ma’lumotlari noto‘g‘ri' });
            return;
        }
        const item = submittedItem;
        const quantityText = String(item.quantity ?? '');
        const amountText = String(item.totalCost ?? '');
        if (typeof item.inventoryId !== 'string' || !item.inventoryId ||
            !/^\d{1,12}(?:\.\d{1,6})?$/.test(quantityText) ||
            !/^\d{1,15}$/.test(amountText) || inventoryIds.has(item.inventoryId)) {
            res.status(400).json({ success: false, message: 'Bozorlik mahsuloti ma’lumotlari noto‘g‘ri' });
            return;
        }
        const quantity = new client_1.Prisma.Decimal(quantityText);
        const totalCost = new client_1.Prisma.Decimal(amountText);
        if (!quantity.isFinite() || !quantity.greaterThan(0) || !totalCost.isFinite() || !totalCost.greaterThan(0)) {
            res.status(400).json({ success: false, message: 'Miqdor va jami summa 0 dan katta bo‘lishi kerak' });
            return;
        }
        inventoryIds.add(item.inventoryId);
        parsedItems.push({ inventoryId: item.inventoryId, quantity, totalCost });
        totalAmount += BigInt(amountText);
        if (totalAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
            res.status(400).json({ success: false, message: 'Bozorlik summasi ruxsat etilgan chegaradan oshdi' });
            return;
        }
    }
    try {
        const purchase = await prisma.$transaction(async (transaction) => {
            const products = await transaction.inventoryProduct.findMany({
                where: { id: { in: [...inventoryIds] }, isActive: true }
            });
            if (products.length !== inventoryIds.size) {
                throw new Error('BOZORLIK_MAHSULOT_TOPILMADI');
            }
            const productsById = new Map(products.map(product => [product.id, product]));
            const createdPurchase = await transaction.purchase.create({
                data: {
                    userId: req.user.id,
                    totalAmount: new client_1.Prisma.Decimal(totalAmount.toString()),
                    items: {
                        create: parsedItems.map(item => ({
                            inventoryId: item.inventoryId,
                            quantity: item.quantity,
                            unitPrice: item.totalCost.div(item.quantity),
                            totalCost: item.totalCost
                        }))
                    }
                },
                include: {
                    user: { select: { id: true, fullName: true, username: true } },
                    items: { include: { inventory: { select: { id: true, name: true, unit: true } } } }
                }
            });
            for (const item of parsedItems) {
                const product = productsById.get(item.inventoryId);
                const quantityBefore = new client_1.Prisma.Decimal(product.quantity);
                const quantityAfter = quantityBefore.plus(item.quantity);
                await transaction.inventoryProduct.update({
                    where: { id: item.inventoryId },
                    data: { quantity: quantityAfter }
                });
                await transaction.inventoryTransaction.create({
                    data: {
                        inventoryId: item.inventoryId,
                        type: 'XARID',
                        quantityChange: item.quantity,
                        quantityBefore,
                        quantityAfter,
                        reason: `Bozorlik ${createdPurchase.id}`,
                        userId: req.user.id
                    }
                });
            }
            return createdPurchase;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        res.status(201).json({ success: true, data: purchase });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'BOZORLIK_MAHSULOT_TOPILMADI') {
            res.status(400).json({ success: false, message: 'Tanlangan ombor mahsuloti topilmadi yoki faol emas' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Ombor ma’lumotlari bir vaqtda o‘zgardi. Bozorlikni qayta yuboring.' });
            return;
        }
        console.error('Bozorlikni yakunlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Bozorlikni yakunlab bo‘lmadi' });
    }
});
// Xodimlar
app.get('/api/users', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                fullName: true,
                phone: true,
                role: true,
                isActive: true,
                createdAt: true,
                waiterProfile: true,
                cashierProfile: true
            }
        });
        res.json(users);
    }
    catch (error) {
        console.error('Xodimlarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: "Xodimlarni olishda xatolik" });
    }
});
app.post('/api/employees', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const { username, password, fullName, role, phone, commissionPercent } = req.body || {};
    const roles = {
        ADMIN: 'ADMIN',
        CASHIER: 'CASHIER',
        WAITER: 'WAITER',
        KITCHEN: 'KITCHEN'
    };
    const isEmployeeRole = (value) => typeof value === 'string' && Object.hasOwn(roles, value);
    if (typeof username !== 'string' || !username.trim() || username.trim().length > 50 ||
        typeof password !== 'string' || password.length < 8 ||
        typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100 ||
        typeof phone !== 'string' || !phone.trim() || phone.trim().length > 50 || !isEmployeeRole(role) ||
        (commissionPercent !== undefined && (!Number.isFinite(Number(commissionPercent)) || Number(commissionPercent) < 0 || Number(commissionPercent) > 100))) {
        res.status(400).json({ success: false, message: 'Xodim ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const prismaRole = roles[role];
        const passwordHash = await (0, password_1.hashPassword)(password);
        const user = await prisma.user.create({
            data: {
                username: username.trim(),
                passwordHash,
                fullName: fullName.trim(),
                phone: phone.trim(),
                role: prismaRole,
                ...(role === 'WAITER'
                    ? { waiterProfile: { create: {
                                phone: phone.trim(),
                                ...(commissionPercent !== undefined ? { commissionPercent: Number(commissionPercent) } : {})
                            } } }
                    : role === 'CASHIER' ? { cashierProfile: { create: {} } } : {})
            },
            select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, createdAt: true }
        });
        res.status(201).json({ success: true, data: user });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu login allaqachon mavjud' });
            return;
        }
        console.error('Xodim qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xodim qo‘shilmadi' });
    }
});
// Buyurtmalar
app.get('/api/orders', auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN', 'WAITER']), async (req, res) => {
    try {
        const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const where = {};
        if (tableId)
            where.tableId = tableId;
        if (status === 'PENDING') {
            where.status = { in: ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'] };
        }
        else if (status && Object.values(client_1.OrderStatus).includes(status)) {
            where.status = status;
        }
        if (req.query.active === 'true') {
            where.status = { notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'] };
        }
        if (req.query.completed === 'true') {
            where.status = { in: [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI] };
            if (req.user.role === client_1.RoleType.WAITER)
                where.waiterId = req.user.id;
        }
        const orders = await prisma.order.findMany({
            where,
            include: {
                table: { include: { room: true } },
                waiter: { select: { id: true, username: true, fullName: true } },
                processingBy: { select: { id: true, fullName: true, role: true } },
                payments: req.user.role === client_1.RoleType.ADMIN,
                items: { include: { menuItem: { select: { id: true, name: true, unit: true, sellingPrice: true } } } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders.map(order => ({
            ...order,
            tableNumber: order.table?.number,
            items: order.items.map(item => ({
                ...item,
                name: item.menuItem.name,
                productName: item.menuItem.name,
                price: item.unitPrice
            }))
        })));
    }
    catch (error) {
        console.error('Buyurtmalarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmalarni olishda xatolik' });
    }
});
app.post('/api/orders/:id/return-item', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER']), async (req, res) => {
    const orderId = typeof req.params.id === 'string' ? req.params.id : '';
    const orderItemId = typeof req.body?.orderItemId === 'string' ? req.body.orderItemId : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(req.body.idempotencyKey) ? req.body.idempotencyKey : '';
    const quantityText = String(req.body?.quantity ?? '');
    if (!orderId || !orderItemId || !reason || !idempotencyKey ||
        !/^\d{1,10}(?:\.\d{1,6})?$/.test(quantityText) || Number(quantityText) <= 0) {
        res.status(400).json({ success: false, message: 'Qaytarish so‘rovi ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const order = await prisma.order.findFirst({
            where: { id: orderId, waiterId: req.user.id },
            select: {
                id: true,
                status: true,
                items: { where: { id: orderItemId }, select: { id: true, quantity: true } }
            }
        });
        const item = order?.items[0];
        if (!order || !item) {
            res.status(404).json({ success: false, message: 'O‘zingizning buyurtmangizdagi taom topilmadi' });
            return;
        }
        const requestedQuantity = new client_1.Prisma.Decimal(quantityText);
        if (!requestedQuantity.equals(item.quantity)) {
            res.status(400).json({ success: false, message: 'Qisman qaytarish hozircha qo‘llab-quvvatlanmaydi; to‘liq taomni tanlang' });
            return;
        }
        const result = await prisma.$transaction(async (tx) => {
            const requestAuditId = `waiter-return:${idempotencyKey}`;
            const existing = await tx.auditLog.findUnique({
                where: { id: requestAuditId },
                select: { id: true, newValue: true }
            });
            if (existing?.newValue) {
                try {
                    const request = JSON.parse(existing.newValue);
                    if (request.idempotencyKey === idempotencyKey)
                        return { duplicate: true };
                }
                catch { /* Treat malformed historical audit data as a separate request. */ }
            }
            const created = await tx.auditLog.create({
                data: {
                    userId: req.user.id,
                    action: 'WAITER_RETURN_REQUESTED',
                    entity: 'Order',
                    entityId: order.id,
                    newValue: JSON.stringify({ orderItemId: item.id, quantity: quantityText, reason, idempotencyKey, status: order.status }),
                    id: requestAuditId
                },
                select: { id: true, createdAt: true }
            });
            return { duplicate: false, request: created };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        res.status(result.duplicate ? 200 : 202).json({
            success: true,
            duplicate: result.duplicate,
            message: 'Qaytarish so‘rovi kassir/Admin ko‘rib chiqishiga yuborildi',
            ...(result.duplicate ? {} : { data: result.request })
        });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Qaytarish so‘rovi allaqachon yuborilgan' });
            return;
        }
        console.error('Ofitsiant qaytarish so‘rovini yuborishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qaytarish so‘rovini yuborib bo‘lmadi' });
    }
});
app.post('/api/orders', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    const { tableId, items, note, guestCount } = req.body || {};
    if (typeof tableId !== 'string' || !tableId.trim() || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'Stol va buyurtma taomlarini tanlang' });
        return;
    }
    if (items.some(item => !item || typeof (item.productId || item.menuItemId) !== 'string' ||
        !/^\d{1,10}(?:\.\d{1,6})?$/.test(String(item.quantity)) || Number(item.quantity) <= 0 ||
        (item.note !== undefined && typeof item.note !== 'string'))) {
        res.status(400).json({ success: false, error: 'Buyurtma tarkibidagi taomlar yoki miqdor noto‘g‘ri' });
        return;
    }
    if (guestCount !== undefined && (!Number.isInteger(Number(guestCount)) || Number(guestCount) < 1)) {
        res.status(400).json({ success: false, error: 'Mehmonlar sonini to‘g‘ri kiriting' });
        return;
    }
    try {
        const table = await prisma.table.findFirst({
            where: { id: tableId.trim(), isActive: true, room: { isActive: true } },
            select: { id: true, roomId: true }
        });
        if (!table) {
            res.status(404).json({ success: false, error: 'Stol topilmadi yoki faol emas' });
            return;
        }
        const requestedIds = items.map(item => String(item.productId || item.menuItemId));
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: requestedIds }, isActive: true, category: { isActive: true } },
            select: { id: true, name: true, sellingPrice: true }
        });
        const menuById = new Map(menuItems.map(item => [item.id, item]));
        if (menuById.size !== new Set(requestedIds).size) {
            res.status(400).json({ success: false, error: 'Buyurtmadagi taom topilmadi yoki faol emas' });
            return;
        }
        const orderItems = items.map(item => {
            const menuItem = menuById.get(String(item.productId || item.menuItemId));
            const quantity = new client_1.Prisma.Decimal(String(item.quantity));
            const unitPrice = new client_1.Prisma.Decimal(menuItem.sellingPrice);
            return {
                menuItemId: menuItem.id,
                quantity,
                unitPrice,
                totalPrice: unitPrice.mul(quantity).toDecimalPlaces(2),
                notes: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : null
            };
        });
        const totalAmount = orderItems.reduce((total, item) => total.plus(item.totalPrice), new client_1.Prisma.Decimal(0));
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const orderNumber = `${date}-${(0, crypto_1.randomBytes)(4).toString('hex').toUpperCase()}`;
        const order = await prisma.order.create({
            data: {
                orderNumber,
                tableId: table.id,
                waiterId: req.user.id,
                guestCount: guestCount === undefined ? 1 : Number(guestCount),
                status: client_1.OrderStatus.YANGI,
                source: 'WAITER',
                createdById: req.user.id,
                subtotal: totalAmount,
                totalAmount,
                items: { create: orderItems },
                statusHistory: { create: {
                        status: client_1.OrderStatus.YANGI,
                        userId: req.user.id,
                        ...(typeof note === 'string' && note.trim() ? { comment: note.trim() } : {})
                    } }
            },
            include: {
                table: { include: { room: true } },
                waiter: { select: { id: true, username: true, fullName: true } },
                items: { include: { menuItem: { select: { id: true, name: true, unit: true, sellingPrice: true } } } }
            }
        });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: order.id, tableId: table.id, roomId: table.roomId, status: order.status });
        (0, socket_1.emitSocketEvent)('table_status_updated', { tableId: table.id, roomId: table.roomId });
        res.status(201).json({ success: true, message: 'Buyurtma muvaffaqiyatli yaratildi', data: order });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Buyurtma raqami to‘qnashdi, qayta urinib ko‘ring' });
            return;
        }
        console.error('Ofitsiant buyurtmasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtma yaratishda xatolik yuz berdi' });
    }
});
app.post('/api/orders/:id/approve', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
            return;
        }
        const processingExpired = !order.processingAt || Date.now() - order.processingAt.getTime() > 10 * 60 * 1000;
        if (order.processingById && order.processingById !== req.user.id && !processingExpired) {
            res.status(409).json({ success: false, error: 'Buyurtma kassir tomonidan qayta ishlanmoqda' });
            return;
        }
        if (!['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(order.status)) {
            res.status(409).json({ success: false, error: 'Bu buyurtmani tasdiqlab bo‘lmaydi' });
            return;
        }
        const updated = await prisma.$transaction(async (tx) => {
            const changed = await tx.order.updateMany({
                where: { id: order.id, status: order.status, processingById: order.processingById, processingAt: order.processingAt },
                data: { status: client_1.OrderStatus.TASDIQLANDI, approvedAt: new Date(),
                    ...(processingExpired ? { processingById: null, processingAt: null } : {}) }
            });
            if (!changed.count)
                return null;
            await tx.orderStatusHistory.create({ data: { orderId: order.id, status: client_1.OrderStatus.TASDIQLANDI, userId: req.user.id } });
            return tx.order.findUnique({ where: { id: order.id }, include: { table: { include: { room: true } } } });
        }, { maxWait: 10000, timeout: 30000 });
        if (!updated) {
            res.status(409).json({ success: false, error: 'Buyurtma holati o‘zgardi. Qayta yuklang.' });
            return;
        }
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: updated.id, tableId: updated.tableId, status: updated.status });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: updated.id, tableId: updated.tableId, roomId: updated.table?.roomId, status: updated.status });
        res.json({ success: true, message: 'Buyurtma tasdiqlandi', data: updated });
    }
    catch (error) {
        console.error('Buyurtmani tasdiqlashda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtmani tasdiqlashda xatolik yuz berdi' });
    }
});
app.post('/api/orders/:id/reject', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
            return;
        }
        const processingExpired = !order.processingAt || Date.now() - order.processingAt.getTime() > 10 * 60 * 1000;
        if (order.processingById && order.processingById !== req.user.id && !processingExpired) {
            res.status(409).json({ success: false, error: 'Buyurtma kassir tomonidan qayta ishlanmoqda' });
            return;
        }
        if (!['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(order.status)) {
            res.status(409).json({ success: false, error: 'Bu buyurtmani rad etib bo‘lmaydi' });
            return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        const updated = await prisma.$transaction(async (tx) => {
            const changed = await tx.order.updateMany({
                where: { id: order.id, status: order.status, processingById: order.processingById, processingAt: order.processingAt },
                data: { status: client_1.OrderStatus.BEKOR_QILINDI,
                    ...(processingExpired ? { processingById: null, processingAt: null } : {}) }
            });
            if (!changed.count)
                return null;
            await tx.orderStatusHistory.create({ data: {
                    orderId: order.id, status: client_1.OrderStatus.BEKOR_QILINDI, userId: req.user.id,
                    ...(reason ? { comment: reason } : {})
                } });
            return tx.order.findUnique({ where: { id: order.id }, include: { table: { include: { room: true } } } });
        }, { maxWait: 10000, timeout: 30000 });
        if (!updated) {
            res.status(409).json({ success: false, error: 'Buyurtma holati o‘zgardi. Qayta yuklang.' });
            return;
        }
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: updated.id, tableId: updated.tableId, status: updated.status });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: updated.id, tableId: updated.tableId, roomId: updated.table?.roomId, status: updated.status });
        res.json({ success: true, message: 'Buyurtma rad etildi', data: updated });
    }
    catch (error) {
        console.error('Buyurtmani rad etishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtmani rad etishda xatolik yuz berdi' });
    }
});
app.post('/api/tables/:tableId/pay', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'CASHIER', 'ADMIN']), async (req, res) => {
    const paymentMethods = {
        NAQD: client_1.PaymentMethod.NAQD, Naqd: client_1.PaymentMethod.NAQD,
        PLASTIK: client_1.PaymentMethod.PLASTIK, 'Plastik karta': client_1.PaymentMethod.PLASTIK,
        ELEKTRON: client_1.PaymentMethod.ELEKTRON, 'Elektron to‘lov': client_1.PaymentMethod.ELEKTRON
    };
    const method = typeof req.body?.paymentMethod === 'string' && Object.hasOwn(paymentMethods, req.body.paymentMethod)
        ? paymentMethods[req.body.paymentMethod] : null;
    const key = typeof req.body?.idempotencyKey === 'string' &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(req.body.idempotencyKey) ? req.body.idempotencyKey : '';
    if (!method || !key) {
        res.status(400).json({ success: false, message: 'To‘lov turi yoki takrorlanishni himoyalovchi identifikator noto‘g‘ri' });
        return;
    }
    const hash = (0, crypto_1.createHash)('sha256').update(JSON.stringify({
        tableId: req.params.tableId,
        method
    })).digest('hex');
    try {
        const previous = await prisma.idempotencyRecord.findUnique({ where: { key } });
        if (previous) {
            if (previous.userId !== req.user.id || previous.operation !== 'TABLE_PAYMENT' || previous.requestHash !== hash) {
                res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
                return;
            }
            res.json({ success: true, duplicate: true, data: JSON.parse(previous.responseJson) });
            return;
        }
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "tableId" = ${req.params.tableId} ORDER BY "id" FOR UPDATE`;
            const orders = await tx.order.findMany({
                where: {
                    tableId: req.params.tableId,
                    status: { notIn: [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI, client_1.OrderStatus.BEKOR_QILINDI, client_1.OrderStatus.QAYTARILDI] }
                },
                select: {
                    id: true, orderNumber: true, status: true, totalAmount: true, processingById: true, tableId: true,
                    table: { select: { roomId: true } }, debt: { select: { amount: true, remaining: true } },
                    payments: { select: { amount: true } },
                    items: { select: { quantity: true, totalPrice: true, menuItem: { select: { name: true } } } }
                }
            });
            if (!orders.length)
                throw new Error('TABLE_NO_ORDERS');
            const paidOrderIds = [];
            const updates = [];
            const updatedInventoryIds = new Set();
            for (const order of orders) {
                if (order.processingById && order.processingById !== req.user.id)
                    throw new Error('ORDER_LOCKED');
                const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), new client_1.Prisma.Decimal(0));
                const due = new client_1.Prisma.Decimal(order.totalAmount).minus(paid).minus(order.debt?.amount || 0);
                if (!due.greaterThan(0))
                    continue;
                const payment = await tx.payment.create({
                    data: {
                        orderId: order.id,
                        cashierId: req.user.id,
                        method,
                        amount: due,
                        idempotencyKey: `${key}_${order.id}`
                    },
                    select: { id: true }
                });
                const status = order.debt?.remaining.greaterThan(0) ? client_1.OrderStatus.QISMAN_TOLANDI : client_1.OrderStatus.TOLANDI;
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status,
                        paidAt: status === client_1.OrderStatus.TOLANDI ? new Date() : null,
                        processingById: null,
                        processingAt: null,
                        statusHistory: { create: { status, userId: req.user.id, comment: 'Stol hisob-kitobi' } }
                    }
                });
                if (status === client_1.OrderStatus.TOLANDI) {
                    await (0, order_packaging_1.deductPackaging)(tx, order.id, req.user.id);
                    for (const id of await (0, order_recipes_1.deductOrderRecipes)(tx, order.id, req.user.id))
                        updatedInventoryIds.add(id);
                }
                const receiptNumber = `${order.orderNumber}-${Date.now()}-${(0, crypto_1.randomBytes)(2).toString('hex').toUpperCase()}`;
                await tx.receipt.create({
                    data: {
                        orderId: order.id,
                        receiptNumber,
                        qrHash: (0, crypto_1.createHash)('sha256').update((0, crypto_1.randomBytes)(32)).digest('hex')
                    }
                });
                await tx.printJob.create({
                    data: {
                        orderId: order.id,
                        jobType: 'RECEIPT',
                        payload: JSON.stringify({
                            restaurantName: 'ChoyxonaAzizxon',
                            receiptNumber,
                            orderNumber: order.orderNumber,
                            cashier: req.user.fullName,
                            total: due.toString(),
                            method,
                            items: order.items.map(item => ({
                                name: item.menuItem.name,
                                quantity: item.quantity.toString(),
                                amount: item.totalPrice.toString()
                            }))
                        })
                    }
                });
                await tx.auditLog.create({
                    data: { userId: req.user.id, action: 'PAYMENT_RECEIVED', entity: 'Order', entityId: order.id, newValue: JSON.stringify({ paymentId: payment.id, amount: due.toString(), method }) }
                });
                if (method === client_1.PaymentMethod.NAQD) {
                    const session = await tx.cashSession.findFirst({ where: { activeCashierId: req.user.id }, select: { id: true } });
                    await tx.cashMovement.create({
                        data: {
                            userId: req.user.id,
                            type: 'SALE',
                            amount: due,
                            referenceId: order.id,
                            ...(session ? { sessionId: session.id } : {})
                        }
                    });
                }
                paidOrderIds.push(order.id);
                updates.push({ orderId: order.id, status, tableId: order.tableId, roomId: order.table.roomId, remaining: '0' });
            }
            if (!paidOrderIds.length)
                throw new Error('TABLE_ALREADY_PAID');
            const response = { paidOrderIds };
            await tx.idempotencyRecord.create({
                data: {
                    key, userId: req.user.id, operation: 'TABLE_PAYMENT',
                    requestHash: hash, responseJson: JSON.stringify(response)
                }
            });
            return { response, updates, updatedInventoryIds: [...updatedInventoryIds] };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 60000 });
        for (const update of result.updates) {
            (0, socket_1.emitSocketEvent)('paymentReceived', update);
            (0, socket_1.emitSocketEvent)('orderUpdate', update);
            (0, socket_1.emitSocketEvent)('order_status_updated', update);
        }
        (0, socket_1.emitSocketEvent)('table_status_updated', { tableId: req.params.tableId });
        if (result.updatedInventoryIds.length)
            (0, socket_1.emitSocketEvent)('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.json({ success: true, data: result.response });
    }
    catch (error) {
        try {
            const previous = await prisma.idempotencyRecord.findUnique({ where: { key } });
            if (previous) {
                if (previous.userId !== req.user.id || previous.operation !== 'TABLE_PAYMENT' || previous.requestHash !== hash) {
                    res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
                    return;
                }
                res.json({ success: true, duplicate: true, data: JSON.parse(previous.responseJson) });
                return;
            }
        }
        catch { /* Preserve the original failure if replay cannot be read. */ }
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldig‘i yetarli emas` });
            return;
        }
        if (error instanceof Error && error.message === 'TABLE_NO_ORDERS') {
            res.status(409).json({ success: false, message: 'Stolda to‘lanmagan buyurtmalar yo‘q' });
            return;
        }
        if (error instanceof Error && error.message === 'TABLE_ALREADY_PAID') {
            res.status(409).json({ success: false, message: 'Buyurtmalar allaqachon to‘langan' });
            return;
        }
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsuloti qoldig‘i yetarli emas' });
            return;
        }
        if (error instanceof Error && error.message === 'ORDER_LOCKED') {
            res.status(409).json({ success: false, message: 'Buyurtma kassir tomonidan qayta ishlanmoqda' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
            res.status(409).json({ success: false, message: 'To‘lov allaqachon yuborilgan. Sahifani yangilang.' });
            return;
        }
        console.error('Stol uchun to‘lovni saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stol to‘lovini saqlab bo‘lmadi' });
    }
});
app.get('/api/waiter/calls', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (_req, res) => {
    try {
        const calls = await prisma.waiterCall.findMany({
            where: { status: { not: 'YAKUNLANDI' } },
            include: {
                table: { select: { number: true, room: { select: { name: true } } } },
                calledBy: { select: { fullName: true, role: true } }
            },
            orderBy: { createdAt: 'asc' }
        });
        res.json(calls.map(call => ({ ...call, tableNumber: call.table.number })));
    }
    catch (error) {
        console.error('Ofitsiant chaqiruvlarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruvlarni olib bo‘lmadi' });
    }
});
app.post('/api/waiter/cashier-call', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER']), async (req, res) => {
    const tableId = typeof req.body?.tableId === 'string' ? req.body.tableId : '';
    if (!tableId) {
        res.status(400).json({ success: false, message: 'Stolni tanlang' });
        return;
    }
    try {
        const table = await prisma.table.findFirst({
            where: { id: tableId, isActive: true, room: { isActive: true } },
            select: { id: true, number: true, room: { select: { name: true } } }
        });
        if (!table) {
            res.status(404).json({ success: false, message: 'Faol stol topilmadi' });
            return;
        }
        const existing = await prisma.waiterCall.findFirst({
            where: { tableId: table.id, kind: 'CASHIER_ASSIST', status: { not: 'YAKUNLANDI' } }
        });
        if (existing) {
            res.status(409).json({ success: false, message: 'Bu stol uchun kassir chaqiruvi allaqachon faol' });
            return;
        }
        const call = await prisma.waiterCall.create({
            data: { tableId: table.id, calledById: req.user.id, kind: 'CASHIER_ASSIST' }
        });
        (0, socket_1.emitSocketEvent)('waiter_call', {
            callId: call.id,
            tableId: table.id,
            tableNumber: table.number,
            roomName: table.room.name,
            waiterName: req.user.fullName,
            createdAt: call.createdAt
        });
        res.status(201).json({ success: true, data: call });
    }
    catch (error) {
        console.error('Kassirni chaqirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassirni chaqirib bo‘lmadi' });
    }
});
app.post('/api/waiter/calls/:id/accept', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const call = await prisma.waiterCall.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
        if (!call || call.status === 'YAKUNLANDI') {
            res.status(404).json({ success: false, message: 'Faol chaqiruv topilmadi' });
            return;
        }
        const updated = await prisma.waiterCall.update({
            where: { id: call.id },
            data: { status: 'QABUL_QILINDI', acceptedById: req.user.id }
        });
        await prisma.auditLog.create({
            data: { userId: req.user.id, action: 'WAITER_CALL_ACCEPTED', entity: 'WaiterCall', entityId: call.id }
        });
        (0, socket_1.emitSocketEvent)('waiter_call_updated', { callId: updated.id, status: updated.status });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        console.error('Chaqiruvni qabul qilishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruvni qabul qilib bo‘lmadi' });
    }
});
app.post('/api/waiter/calls/:id/complete', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const call = await prisma.waiterCall.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
        if (!call || call.status === 'YAKUNLANDI') {
            res.status(404).json({ success: false, message: 'Faol chaqiruv topilmadi' });
            return;
        }
        const updated = await prisma.waiterCall.update({
            where: { id: call.id },
            data: { status: 'YAKUNLANDI', completedById: req.user.id }
        });
        await prisma.auditLog.create({
            data: { userId: req.user.id, action: 'WAITER_CALL_COMPLETED', entity: 'WaiterCall', entityId: call.id }
        });
        (0, socket_1.emitSocketEvent)('waiter_call_updated', { callId: updated.id, status: updated.status });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        console.error('Chaqiruvni yakunlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruvni yakunlab bo‘lmadi' });
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
Promise.resolve().then(() => {
    (0, auth_1.initializeAuthSecret)();
    return ensureInitialAdmin();
}).then(() => {
    server.listen(PORT, () => {
        console.log(`Server ${PORT}-portda ishga tushdi!`);
    });
}).catch(error => {
    console.error('Serverni ishga tushirishda xatolik:', error);
    process.exit(1);
});
