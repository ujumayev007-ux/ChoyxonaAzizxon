import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { OrderStatus, Prisma, PrismaClient, RoleType } from '@prisma/client';
import path from 'path';
import { Context, Telegraf } from 'telegraf';
import kitchenRoutes from './routes/kitchen.routes';
import { emitSocketEvent, initSocket } from './socket';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { authenticateToken, clearAuthCookie, requireRole, setAuthCookie } from './middleware/auth';

// 1. Muhit o'zgaruvchilarini eng boshida yuklash
dotenv.config();

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`${salt}:${derivedKey.toString('hex')}`);
        });
    });
}

function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [salt, storedHash, ...extra] = passwordHash.split(':');
    if (!salt || !storedHash || extra.length || !/^[\da-f]+$/i.test(salt) || !/^[\da-f]{128}$/i.test(storedHash)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            const expected = Buffer.from(storedHash, 'hex');
            resolve(expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey));
        });
    });
}

async function ensureInitialAdmin(): Promise<void> {
    const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!username && !password) {
        const adminCount = await prisma.user.count({ where: { role: RoleType.ADMIN } });
        if (adminCount === 0) {
            console.warn('No administrator account exists. Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to create the first admin.');
        }
        return;
    }
    if (!username || !password || password.length < 12) {
        throw new Error('Set both INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD (at least 12 characters) for initial admin provisioning.');
    }

    const adminCount = await prisma.user.count({ where: { role: RoleType.ADMIN } });
    if (adminCount > 0) return;
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
        throw new Error('INITIAL_ADMIN_USERNAME already belongs to a non-admin account.');
    }
    await prisma.user.create({
        data: {
            username,
            passwordHash: await hashPassword(password),
            fullName: process.env.INITIAL_ADMIN_FULL_NAME?.trim() || 'Administrator',
            role: RoleType.ADMIN
        }
    });
    console.log('Initial administrator account created.');
}

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});
initSocket(io);
app.use('/api/kitchen', kitchenRoutes);

async function loginUser(username: unknown, password: unknown, allowedRoles: RoleType[]) {
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) return null;
    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user || !user.isActive || !allowedRoles.includes(user.role) || !(await verifyPassword(password, user.passwordHash))) {
        return null;
    }
    return user;
}

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.username, req.body?.password, [RoleType.ADMIN]);
        if (!user) {
            res.status(401).json({ success: false, message: 'Login yoki parol noto‘g‘ri' });
            return;
        }
        setAuthCookie(res, user);
        res.json({ success: true, user: { id: user.id, fullName: user.fullName, role: user.role } });
    } catch (error) {
        console.error('Admin tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});

app.post('/api/auth/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
});

app.get('/api/waiter/me', authenticateToken, requireRole(['WAITER']), (req, res) => {
    res.json({
        success: true,
        waiter: { id: req.user!.id, name: req.user!.fullName, login: req.user!.username }
    });
});

app.post('/api/waiter/login', async (req, res) => {
    try {
        const user = await loginUser(req.body?.login, req.body?.password, [RoleType.WAITER]);
        if (!user) {
            res.status(401).json({ success: false, error: 'Login yoki parol xato!' });
            return;
        }
        setAuthCookie(res, user);
        res.json({
            success: true,
            waiter: { id: user.id, name: user.fullName, login: user.username }
        });
    } catch (error) {
        console.error('Ofitsiant tizimiga kirishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Tizimga kirishda xatolik yuz berdi' });
    }
});

app.post('/api/waiter/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
});

// ==========================================
// 2. TELEGRAM BOT (Telegraf)
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = botToken ? new Telegraf(botToken) : null;

bot?.start((ctx: Context) => {
    const startPayload = (ctx as Context & { startPayload?: string }).startPayload;
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
    }).catch((err: unknown) => {
        console.error('Botni ishga tushirishda xatolik:', err);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
    console.warn('TELEGRAM_BOT_TOKEN is not set; Telegram bot is disabled.');
}

// ==========================================
// 3. ADMIN PANEL VA API ROUTELARI
// ==========================================

// Xonalar va stollar
app.get('/api/rooms', authenticateToken, requireRole(['ADMIN', 'WAITER']), async (req, res) => {
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
    } catch (error) {
        console.error('Xonalarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xonalarni olishda xatolik yuz berdi' });
    }
});

app.post('/api/rooms', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name || name.length > 100) {
            res.status(400).json({ success: false, message: 'Xona nomini to‘g‘ri kiriting' });
            return;
        }
        const room = await prisma.room.create({ data: { name } });
        emitSocketEvent('restaurant_structure_updated', { type: 'room_created', roomId: room.id });
        res.json({ success: true, data: room });
    } catch (error) {
        console.error('Xona qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xona qo‘shilmadi' });
    }
});

app.delete('/api/rooms/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
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
        emitSocketEvent('restaurant_structure_updated', { type: 'room_deleted', roomId: id });
        res.json({ success: true });
    } catch (error) {
        console.error('Xonani o‘chirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xonani o‘chirib bo‘lmadi' });
    }
});

app.post('/api/tables', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
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
        const qrCodeToken = randomBytes(32).toString('hex');
        const table = await prisma.table.create({
            data: { number, roomId, qrCodeToken }
        });
        emitSocketEvent('restaurant_structure_updated', { type: 'table_created', roomId, tableId: table.id });
        emitSocketEvent('table_status_updated', { roomId, tableId: table.id, status: 'AVAILABLE' });
        res.status(201).json({ success: true, message: 'Stol muvaffaqiyatli qo‘shildi', data: table });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu stol raqami allaqachon mavjud' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'Tanlangan xona mavjud emas' });
            return;
        }
        console.error('Stol qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stol qo‘shishda xatolik yuz berdi' });
    }
});

app.delete('/api/tables/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
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
        emitSocketEvent('restaurant_structure_updated', { type: 'table_deleted', roomId: table.roomId, tableId: id });
        emitSocketEvent('table_status_updated', { roomId: table.roomId, tableId: id, status: 'DELETED' });
        res.json({ success: true });
    } catch (error) {
        console.error('Stolni o‘chirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stolni o‘chirib bo‘lmadi' });
    }
});

app.post('/api/tables/:id/free', authenticateToken, requireRole(['WAITER', 'ADMIN']), async (req, res) => {
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
    } catch (error) {
        console.error('Stol holatini tekshirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Stol holatini yangilashda xatolik yuz berdi' });
    }
});

// Menyu va tannarx
app.get('/api/menu/categories', authenticateToken, requireRole(['ADMIN']), async (_req, res) => {
    try {
        const categories = await prisma.menuCategory.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true }
        });
        res.json(categories);
    } catch (error) {
        console.error('Menyu kategoriyalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyu kategoriyalarini olishda xatolik' });
    }
});

app.get('/api/menu', async (req, res) => {
    try {
        const menuItems = await prisma.menuItem.findMany({
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        res.json(menuItems);
    } catch (error) {
        console.error('Menyuni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Menyuni olib kelishda xatolik' });
    }
});

app.post('/api/menu', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const { name, categoryId, description, sellingPrice, internalCostPrice, unit, preparationTime, kitchenSection } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof categoryId !== 'string' || !categoryId ||
        !Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0 ||
        (internalCostPrice !== undefined && (!Number.isFinite(Number(internalCostPrice)) || Number(internalCostPrice) < 0)) ||
        (preparationTime !== undefined && (!Number.isInteger(Number(preparationTime)) || Number(preparationTime) < 0))) {
        res.status(400).json({ success: false, message: 'Menyu ma’lumotlari noto‘g‘ri' });
        return;
    }

    try {
        const category = await prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!category) {
            res.status(400).json({ success: false, message: 'Menyu kategoriyasi topilmadi' });
            return;
        }
        const menuItem = await prisma.menuItem.create({
            data: {
                name: name.trim(),
                categoryId,
                description: typeof description === 'string' && description.trim() ? description.trim() : null,
                sellingPrice: Number(sellingPrice),
                ...(internalCostPrice !== undefined ? { internalCostPrice: Number(internalCostPrice) } : {}),
                ...(typeof unit === 'string' && unit.trim() ? { unit: unit.trim() } : {}),
                ...(preparationTime !== undefined ? { preparationTime: Number(preparationTime) } : {}),
                ...(typeof kitchenSection === 'string' && kitchenSection.trim() ? { kitchenSection: kitchenSection.trim() } : {})
            },
            include: { category: true, recipes: { include: { inventory: true } } }
        });
        res.status(201).json({ success: true, data: menuItem });
    } catch (error) {
        console.error('Menyu taomini qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Taom qo‘shilmadi' });
    }
});

// Omborxona
app.get('/api/inventory', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    try {
        const products = await prisma.inventoryProduct.findMany();
        res.json(products);
    } catch (error) {
        console.error('Ombor ma’lumotlarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: "Ombor ma'lumotlarini olishda xatolik" });
    }
});

const createInventoryProduct = async (req: express.Request, res: express.Response) => {
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
    } catch (error) {
        console.error('Ombor mahsulotini qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Ombor mahsuloti qo‘shilmadi' });
    }
};

app.post('/api/inventory', authenticateToken, requireRole(['ADMIN']), createInventoryProduct);
app.post('/api/warehouse', authenticateToken, requireRole(['ADMIN']), createInventoryProduct);

// Xodimlar
app.get('/api/users', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
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
    } catch (error) {
        console.error('Xodimlarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: "Xodimlarni olishda xatolik" });
    }
});

app.post('/api/employees', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
    const { username, password, fullName, role, phone, commissionPercent } = req.body || {};
    const roles = {
        ADMIN: 'ADMIN',
        CASHIER: 'CASHIER',
        WAITER: 'WAITER',
        KITCHEN: 'KITCHEN'
    } as const;
    const isEmployeeRole = (value: unknown): value is keyof typeof roles =>
        typeof value === 'string' && Object.hasOwn(roles, value);
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
        const passwordHash = await hashPassword(password);
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
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Bu login allaqachon mavjud' });
            return;
        }
        console.error('Xodim qo‘shishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xodim qo‘shilmadi' });
    }
});

// Buyurtmalar
app.get('/api/orders', authenticateToken, requireRole(['ADMIN', 'WAITER']), async (req, res) => {
    try {
        const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const where: Prisma.OrderWhereInput = {};
        if (tableId) where.tableId = tableId;
        if (status === 'PENDING') {
            where.status = { in: ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'] };
        } else if (status && Object.values(OrderStatus).includes(status as OrderStatus)) {
            where.status = status as OrderStatus;
        }
        if (req.query.active === 'true') {
            where.status = { notIn: ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'] };
        }
        const orders = await prisma.order.findMany({
            where,
            include: {
                table: { include: { room: true } },
                waiter: { select: { id: true, username: true, fullName: true } },
                payments: req.user!.role === RoleType.ADMIN,
                items: { include: { menuItem: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders.map(order => ({
            ...order,
            tableNumber: order.table.number,
            items: order.items.map(item => ({
                ...item,
                name: item.menuItem.name,
                productName: item.menuItem.name,
                price: item.unitPrice
            }))
        })));
    } catch (error) {
        console.error('Buyurtmalarni olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmalarni olishda xatolik' });
    }
});

app.post('/api/orders', authenticateToken, requireRole(['WAITER', 'ADMIN']), async (req, res) => {
    const { tableId, items, note, guestCount } = req.body || {};
    if (typeof tableId !== 'string' || !tableId.trim() || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'Stol va buyurtma taomlarini tanlang' });
        return;
    }
    if (items.some(item => !item || typeof (item.productId || item.menuItemId) !== 'string' ||
        !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 ||
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
            where: { id: { in: requestedIds }, isActive: true },
            select: { id: true, name: true, sellingPrice: true }
        });
        const menuById = new Map(menuItems.map(item => [item.id, item]));
        if (menuById.size !== new Set(requestedIds).size) {
            res.status(400).json({ success: false, error: 'Buyurtmadagi taom topilmadi yoki faol emas' });
            return;
        }

        const orderItems = items.map(item => {
            const menuItem = menuById.get(String(item.productId || item.menuItemId))!;
            const quantity = Number(item.quantity);
            const unitPrice = Number(menuItem.sellingPrice);
            return {
                menuItemId: menuItem.id,
                quantity,
                unitPrice,
                totalPrice: unitPrice * quantity,
                notes: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : null
            };
        });
        const totalAmount = orderItems.reduce((total, item) => total + item.totalPrice, 0);
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const orderNumber = `${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
        const order = await prisma.order.create({
            data: {
                orderNumber,
                tableId: table.id,
                waiterId: req.user!.id,
                guestCount: guestCount === undefined ? 1 : Number(guestCount),
                status: OrderStatus.YANGI,
                subtotal: totalAmount,
                totalAmount,
                items: { create: orderItems },
                ...(typeof note === 'string' && note.trim()
                    ? { statusHistory: { create: { status: OrderStatus.YANGI, comment: note.trim(), userId: req.user!.id } } }
                    : {})
            },
            include: {
                table: { include: { room: true } },
                waiter: { select: { id: true, username: true, fullName: true } },
                items: { include: { menuItem: true } }
            }
        });

        emitSocketEvent('orderUpdate', { orderId: order.id, tableId: table.id, roomId: table.roomId, status: order.status });
        emitSocketEvent('table_status_updated', { tableId: table.id, roomId: table.roomId });
        res.status(201).json({ success: true, message: 'Buyurtma muvaffaqiyatli yaratildi', data: order });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Buyurtma raqami to‘qnashdi, qayta urinib ko‘ring' });
            return;
        }
        console.error('Ofitsiant buyurtmasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtma yaratishda xatolik yuz berdi' });
    }
});

app.post('/api/orders/:id/approve', authenticateToken, requireRole(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
            return;
        }
        if (!['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(order.status)) {
            res.status(409).json({ success: false, error: 'Bu buyurtmani tasdiqlab bo‘lmaydi' });
            return;
        }
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
                status: OrderStatus.TASDIQLANDI,
                approvedAt: new Date(),
                statusHistory: { create: { status: OrderStatus.TASDIQLANDI, userId: req.user!.id } }
            },
            include: { table: { include: { room: true } } }
        });
        emitSocketEvent('order_status_updated', { orderId: updated.id, tableId: updated.tableId, status: updated.status });
        emitSocketEvent('orderUpdate', { orderId: updated.id, tableId: updated.tableId, roomId: updated.table.roomId, status: updated.status });
        res.json({ success: true, message: 'Buyurtma tasdiqlandi', data: updated });
    } catch (error) {
        console.error('Buyurtmani tasdiqlashda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtmani tasdiqlashda xatolik yuz berdi' });
    }
});

app.post('/api/orders/:id/reject', authenticateToken, requireRole(['WAITER', 'ADMIN']), async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
            return;
        }
        if (!['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(order.status)) {
            res.status(409).json({ success: false, error: 'Bu buyurtmani rad etib bo‘lmaydi' });
            return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
                status: OrderStatus.BEKOR_QILINDI,
                statusHistory: { create: {
                    status: OrderStatus.BEKOR_QILINDI,
                    userId: req.user!.id,
                    ...(reason ? { comment: reason } : {})
                } }
            },
            include: { table: { include: { room: true } } }
        });
        emitSocketEvent('order_status_updated', { orderId: updated.id, tableId: updated.tableId, status: updated.status });
        emitSocketEvent('orderUpdate', { orderId: updated.id, tableId: updated.tableId, roomId: updated.table.roomId, status: updated.status });
        res.json({ success: true, message: 'Buyurtma rad etildi', data: updated });
    } catch (error) {
        console.error('Buyurtmani rad etishda xatolik:', error);
        res.status(500).json({ success: false, error: 'Buyurtmani rad etishda xatolik yuz berdi' });
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
ensureInitialAdmin().then(() => {
    server.listen(PORT, () => {
        console.log(`Server ${PORT}-portda ishga tushdi!`);
    });
}).catch(error => {
    console.error('Serverni ishga tushirishda xatolik:', error);
    process.exit(1);
});
