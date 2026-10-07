"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const password_1 = require("../utils/password");
const order_packaging_1 = require("../utils/order-packaging");
const order_recipes_1 = require("../utils/order-recipes");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, auth_1.requireCashierAccess);
const activeStatuses = [
    client_1.OrderStatus.YANGI,
    client_1.OrderStatus.KUTILMOQDA,
    client_1.OrderStatus.ADMIN_TASDIGINI_KUTMOQDA,
    client_1.OrderStatus.TASDIQLANDI,
    client_1.OrderStatus.OSHXONAGA_YUBORILDI,
    client_1.OrderStatus.TAYYORLANMOQDA,
    client_1.OrderStatus.TAYYOR,
    client_1.OrderStatus.STOLGA_YETKAZILDI,
    client_1.OrderStatus.TOLOV_KUTILMOQDA,
    client_1.OrderStatus.QISMAN_TOLANDI
];
const moneyPattern = /^\d{1,12}(?:\.\d{1,2})?$/;
const quantityPattern = /^\d{1,10}(?:\.\d{1,6})?$/;
const methods = {
    NAQD: client_1.PaymentMethod.NAQD,
    CASH: client_1.PaymentMethod.NAQD,
    cash: client_1.PaymentMethod.NAQD,
    Naqd: client_1.PaymentMethod.NAQD,
    PLASTIK: client_1.PaymentMethod.PLASTIK,
    CARD: client_1.PaymentMethod.PLASTIK,
    card: client_1.PaymentMethod.PLASTIK,
    'Plastik karta': client_1.PaymentMethod.PLASTIK,
    ELEKTRON: client_1.PaymentMethod.ELEKTRON,
    ELECTRONIC: client_1.PaymentMethod.ELEKTRON,
    electronic: client_1.PaymentMethod.ELEKTRON,
    'Elektron to‘lov': client_1.PaymentMethod.ELEKTRON
};
const parseDecimal = (value, pattern = moneyPattern) => {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    if (!pattern.test(text))
        return null;
    const result = new client_1.Prisma.Decimal(text);
    return result.isFinite() ? result : null;
};
const parseMethod = (value) => typeof value === 'string' ? methods[value] || null : null;
const dayStartInTashkent = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 5 * 60 * 60 * 1000);
};
const requestHash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
function getIdempotencyKey(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value) ? value : null;
}
async function readIdempotentResult(key, userId, operation, hash) {
    const record = await db_1.prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!record)
        return null;
    if (record.userId !== userId || record.operation !== operation || record.requestHash !== hash) {
        throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    return JSON.parse(record.responseJson);
}
async function saveIdempotentResult(tx, key, userId, operation, hash, resourceId, result) {
    await tx.idempotencyRecord.create({
        data: { key, userId, operation, requestHash: hash, resourceId, responseJson: JSON.stringify(result) }
    });
}
async function writeAudit(tx, userId, action, entity, entityId, value) {
    await tx.auditLog.create({
        data: {
            userId,
            action,
            entity,
            entityId,
            ...(value === undefined ? {} : { newValue: JSON.stringify(value) })
        }
    });
}
async function openSession(tx, cashierId) {
    return tx.cashSession.findFirst({
        where: { cashierId, activeCashierId: cashierId },
        select: { id: true, startingBalance: true }
    });
}
function createOrderNumber() {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
        .format(new Date()).replace(/-/g, '');
    return `${date}-${(0, crypto_1.randomBytes)(4).toString('hex').toUpperCase()}`;
}
function makeVerification(code) {
    const salt = (0, crypto_1.randomBytes)(16).toString('hex');
    return `${salt}:${(0, crypto_1.createHash)('sha256').update(`${salt}:${code}`).digest('hex')}`;
}
function matchesVerification(code, saved) {
    const [salt, hash, ...extra] = saved.split(':');
    return Boolean(salt && hash && !extra.length &&
        (0, crypto_1.createHash)('sha256').update(`${salt}:${code}`).digest('hex') === hash);
}
async function addCashMovement(tx, userId, type, amount, referenceId, note) {
    const session = await openSession(tx, userId);
    await tx.cashMovement.create({
        data: {
            userId,
            type,
            amount,
            ...(session ? { sessionId: session.id } : {}),
            ...(referenceId ? { referenceId } : {}),
            ...(note ? { note } : {})
        }
    });
}
router.get('/dashboard', async (req, res) => {
    try {
        const start = dayStartInTashkent();
        const paymentWhere = {
            createdAt: { gte: start },
            ...(req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {})
        };
        const expenseWhere = {
            createdAt: { gte: start },
            ...(req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {})
        };
        const refundWhere = {
            createdAt: { gte: start },
            ...(req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {})
        };
        const [payments, expenseAggregate, refundAggregate, debts, debtSales, statusCounts, verificationAlerts, activeOrders, session, movements] = await Promise.all([
            db_1.prisma.payment.groupBy({ by: ['method'], where: paymentWhere, _sum: { amount: true } }),
            db_1.prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
            db_1.prisma.refund.aggregate({ where: refundWhere, _sum: { amount: true } }),
            db_1.prisma.customerDebt.aggregate({
                where: { remaining: { gt: 0 } },
                _sum: { remaining: true },
                _count: { customerId: true }
            }),
            db_1.prisma.customerDebt.aggregate({
                where: {
                    createdAt: { gte: start },
                    ...(req.user.role === client_1.RoleType.CASHIER ? { createdById: req.user.id } : {})
                },
                _sum: { amount: true }
            }),
            db_1.prisma.order.groupBy({
                by: ['status'],
                where: { status: { in: activeStatuses } },
                _count: { id: true }
            }),
            db_1.prisma.takeawayVerification.count({
                where: { attempts: { gt: 0 }, usedAt: null, expiresAt: { gt: new Date() } }
            }),
            db_1.prisma.order.findMany({
                where: {
                    OR: [
                        { status: { in: activeStatuses } },
                        {
                            orderType: client_1.OrderType.TAKEAWAY,
                            status: client_1.OrderStatus.TOLANDI,
                            takeawayVerification: { is: { usedAt: null } }
                        }
                    ]
                },
                select: {
                    id: true, orderNumber: true, orderType: true, source: true, status: true, customerName: true, customerPhone: true,
                    totalAmount: true, createdAt: true, processingAt: true,
                    takeawayVerification: { select: { expiresAt: true, attempts: true, usedAt: true } },
                    table: { select: { id: true, number: true, room: { select: { name: true } } } },
                    waiter: { select: { fullName: true } },
                    customer: { select: { firstName: true, lastName: true, phone: true } },
                    processingBy: { select: { fullName: true, role: true } },
                    payments: { select: { amount: true } },
                    debt: { select: { amount: true } },
                    items: { select: { id: true, quantity: true, unitPrice: true, totalPrice: true, menuItem: { select: { name: true } } } }
                },
                orderBy: { createdAt: 'asc' },
                take: 100
            }),
            openSession(db_1.prisma, req.user.id),
            db_1.prisma.cashMovement.findMany({
                where: { createdAt: { gte: start }, userId: req.user.id },
                select: { type: true, amount: true, createdAt: true }
            })
        ]);
        const sessionMovements = session ? await db_1.prisma.cashMovement.findMany({
            where: { sessionId: session.id },
            select: { amount: true }
        }) : movements;
        const totals = {
            NAQD: new client_1.Prisma.Decimal(0),
            PLASTIK: new client_1.Prisma.Decimal(0),
            ELEKTRON: new client_1.Prisma.Decimal(0)
        };
        payments.forEach(item => {
            if (item.method !== client_1.PaymentMethod.QARZ)
                totals[item.method] = new client_1.Prisma.Decimal(item._sum.amount || 0);
        });
        const cashToday = sessionMovements.reduce((total, movement) => total.plus(movement.amount), new client_1.Prisma.Decimal(0));
        const statusMap = Object.fromEntries(statusCounts.map(item => [item.status, item._count.id]));
        const refundAmount = refundAggregate._sum.amount || new client_1.Prisma.Decimal(0);
        const sales = totals.NAQD.plus(totals.PLASTIK).plus(totals.ELEKTRON)
            .plus(debtSales._sum.amount || new client_1.Prisma.Decimal(0));
        const expenseAmount = expenseAggregate._sum.amount || new client_1.Prisma.Decimal(0);
        res.json({
            success: true,
            data: {
                user: req.user,
                sales: sales.toString(),
                cash: totals.NAQD.toString(),
                card: totals.PLASTIK.toString(),
                electronic: totals.ELEKTRON.toString(),
                debt: (debts._sum.remaining || new client_1.Prisma.Decimal(0)).toString(),
                refunds: refundAmount.toString(),
                expenses: expenseAmount.toString(),
                ...(req.user.role === client_1.RoleType.ADMIN
                    ? { netRevenue: sales.minus(refundAmount).minus(expenseAmount).toString() }
                    : {}),
                openOrders: activeOrders.filter(order => activeStatuses.includes(order.status)).length,
                takeawayOrders: activeOrders.filter(order => order.orderType === client_1.OrderType.TAKEAWAY).length,
                debtors: debts._count.customerId,
                registerCash: session ? cashToday.toString() : null,
                verificationAlerts,
                statusCounts: statusMap,
                activeOrders
            }
        });
    }
    catch (error) {
        console.error('Kassir bosh sahifasini yuklashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa ma’lumotlarini yuklab bo‘lmadi' });
    }
});
router.get('/orders', async (req, res) => {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const orderType = req.query.type === 'TAKEAWAY' ? client_1.OrderType.TAKEAWAY :
        req.query.type === 'DINE_IN' ? client_1.OrderType.DINE_IN : undefined;
    const status = typeof req.query.status === 'string' &&
        Object.values(client_1.OrderStatus).includes(req.query.status)
        ? req.query.status : undefined;
    try {
        const orders = await db_1.prisma.order.findMany({
            where: {
                AND: [
                    ...(status ? [{ status }] : []),
                    ...(orderType ? [{ orderType }] : []),
                    req.query.closed === 'true'
                        ? { status: { in: [client_1.OrderStatus.QISMAN_TOLANDI, client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI, client_1.OrderStatus.QAYTARILDI] } }
                        : {
                            OR: [
                                { status: { in: activeStatuses } },
                                {
                                    orderType: client_1.OrderType.TAKEAWAY,
                                    status: client_1.OrderStatus.TOLANDI,
                                    takeawayVerification: { is: { usedAt: null } }
                                }
                            ]
                        }
                ],
                ...(term ? {
                    OR: [
                        { orderNumber: { contains: term, mode: 'insensitive' } },
                        { id: term },
                        { table: { number: { contains: term, mode: 'insensitive' } } },
                        { customer: { OR: [
                                    { firstName: { contains: term, mode: 'insensitive' } },
                                    { lastName: { contains: term, mode: 'insensitive' } },
                                    { phoneDigits: { contains: term.replace(/\D/g, '') } }
                                ] } }
                    ]
                } : {})
            },
            select: {
                id: true, orderNumber: true, orderType: true, source: true, status: true,
                subtotal: true, discount: true, totalAmount: true, customerName: true, customerPhone: true,
                createdAt: true, paidAt: true, processingAt: true,
                takeawayVerification: { select: { expiresAt: true, attempts: true, usedAt: true } },
                table: { select: { id: true, number: true, room: { select: { name: true } } } },
                waiter: { select: { id: true, fullName: true } },
                createdBy: { select: { id: true, fullName: true, role: true } },
                processingBy: { select: { id: true, fullName: true, role: true } },
                customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true, phone: true } },
                items: { select: {
                        id: true, menuItemId: true, quantity: true, unitPrice: true, totalPrice: true, notes: true,
                        menuItem: { select: { id: true, name: true, unit: true } }
                    } },
                packagingItems: { select: {
                        id: true, quantity: true, unitPrice: true, totalPrice: true,
                        inventory: { select: { id: true, name: true, unit: true } }
                    } },
                payments: { select: { id: true, amount: true, method: true, changeAmount: true, createdAt: true } },
                refunds: { select: { items: { select: { orderItemId: true, quantity: true } } } },
                debt: { select: { amount: true } }
            },
            orderBy: { createdAt: req.query.closed === 'true' ? 'desc' : 'asc' },
            take: 100
        });
        res.json({ success: true, data: orders });
    }
    catch (error) {
        console.error('Kassir buyurtmalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmalarni yuklab bo‘lmadi' });
    }
});
router.post('/orders', async (req, res) => {
    const type = req.body?.orderType === 'TAKEAWAY' ? client_1.OrderType.TAKEAWAY : client_1.OrderType.DINE_IN;
    const itemsInput = req.body?.items;
    const packagingInput = req.body?.packaging;
    if (!Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 100 ||
        itemsInput.some(item => !item || typeof item.menuItemId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0))) {
        res.status(400).json({ success: false, message: 'Buyurtma taomlari yoki miqdori noto‘g‘ri' });
        return;
    }
    if (type === client_1.OrderType.DINE_IN && typeof req.body?.tableId !== 'string') {
        res.status(400).json({ success: false, message: 'Zal buyurtmasi uchun stol tanlang' });
        return;
    }
    if (type === client_1.OrderType.TAKEAWAY && !req.body?.customerId &&
        (!String(req.body?.customerName || '').trim() || !String(req.body?.customerPhone || '').trim())) {
        res.status(400).json({ success: false, message: 'Olib ketish buyurtmasiga mijoz ismi va telefoni kerak' });
        return;
    }
    if (packagingInput !== undefined && (!Array.isArray(packagingInput) ||
        packagingInput.some(item => !item || typeof item.optionId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0)))) {
        res.status(400).json({ success: false, message: 'Qadoqlash ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const tableId = type === client_1.OrderType.DINE_IN ? req.body.tableId : null;
        if (tableId) {
            const table = await db_1.prisma.table.findFirst({ where: { id: tableId, isActive: true, room: { isActive: true } } });
            if (!table) {
                res.status(400).json({ success: false, message: 'Faol stol topilmadi' });
                return;
            }
        }
        const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : null;
        if (customerId && !await db_1.prisma.customer.findFirst({ where: { id: customerId, isActive: true }, select: { id: true } })) {
            res.status(400).json({ success: false, message: 'Mijoz topilmadi yoki faol emas' });
            return;
        }
        const menuIds = [...new Set(itemsInput.map(item => item.menuItemId))];
        const menu = await db_1.prisma.menuItem.findMany({
            where: { id: { in: menuIds }, isActive: true, category: { isActive: true } },
            select: { id: true, name: true, sellingPrice: true }
        });
        if (menu.length !== menuIds.length) {
            res.status(400).json({ success: false, message: 'Menyu taomi topilmadi yoki faol emas' });
            return;
        }
        const menuById = new Map(menu.map(item => [item.id, item]));
        const orderItems = itemsInput.map(item => {
            const menuItem = menuById.get(item.menuItemId);
            const quantity = parseDecimal(item.quantity, quantityPattern);
            const unitPrice = new client_1.Prisma.Decimal(menuItem.sellingPrice);
            return {
                menuItemId: menuItem.id,
                quantity,
                unitPrice,
                totalPrice: unitPrice.mul(quantity),
                ...(typeof item.notes === 'string' && item.notes.trim() ? { notes: item.notes.trim().slice(0, 500) } : {})
            };
        });
        const packageRows = (packagingInput || []);
        const packageOptions = packageRows.length ? await db_1.prisma.packagingOption.findMany({
            where: { id: { in: packageRows.map(item => item.optionId) }, isActive: true },
            include: { inventory: { select: { id: true, name: true, unit: true, quantity: true } } }
        }) : [];
        if (packageOptions.length !== new Set(packageRows.map(item => item.optionId)).size) {
            res.status(400).json({ success: false, message: 'Qadoqlash mahsuloti topilmadi yoki faol emas' });
            return;
        }
        const packageById = new Map(packageOptions.map(option => [option.id, option]));
        const packagingItems = packageRows.map(item => {
            const option = packageById.get(item.optionId);
            const quantity = parseDecimal(item.quantity, quantityPattern);
            if (new client_1.Prisma.Decimal(option.inventory.quantity).lessThan(quantity))
                throw new Error('PACKAGING_STOCK_SHORT');
            const unitPrice = new client_1.Prisma.Decimal(option.sellingPrice);
            return { inventoryId: option.inventoryId, quantity, unitPrice, totalPrice: unitPrice.mul(quantity) };
        });
        const subtotal = orderItems.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0))
            .plus(packagingItems.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0)));
        const code = type === client_1.OrderType.TAKEAWAY ? String((0, crypto_1.randomInt)(100000, 1000000)) : null;
        const order = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    orderNumber: createOrderNumber(),
                    orderType: type,
                    source: client_1.OrderSource.CASHIER,
                    status: client_1.OrderStatus.TASDIQLANDI,
                    ...(tableId ? { tableId } : {}),
                    ...(customerId ? { customerId } : {}),
                    ...(typeof req.body?.customerName === 'string' && req.body.customerName.trim()
                        ? { customerName: req.body.customerName.trim().slice(0, 120) } : {}),
                    ...(typeof req.body?.customerPhone === 'string' && req.body.customerPhone.trim()
                        ? { customerPhone: req.body.customerPhone.trim().slice(0, 40) } : {}),
                    createdById: req.user.id,
                    waiterId: null,
                    subtotal,
                    totalAmount: subtotal,
                    approvedAt: new Date(),
                    sentToKitchenAt: new Date(),
                    items: { create: orderItems },
                    ...(packagingItems.length ? { packagingItems: { create: packagingItems } } : {}),
                    statusHistory: { create: {
                            status: client_1.OrderStatus.TASDIQLANDI,
                            userId: req.user.id,
                            comment: `Cashier ${type === client_1.OrderType.TAKEAWAY ? 'takeaway' : 'zal'} order created`
                        } },
                    ...(code ? { takeawayVerification: { create: {
                                codeHash: makeVerification(code),
                                expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000)
                            } } } : {})
                },
                select: { id: true, orderNumber: true, totalAmount: true, orderType: true, source: true, status: true }
            });
            await writeAudit(tx, req.user.id, 'ORDER_CREATED', 'Order', created.id, { source: 'CASHIER', orderType: type });
            return created;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: order.id, status: order.status, source: order.source, orderType: order.orderType });
        (0, socket_1.emitSocketEvent)('kitchen_new_order', { orderId: order.id });
        let telegramSent = false;
        if (code && customerId) {
            const customer = await db_1.prisma.customer.findUnique({ where: { id: customerId }, select: { telegramId: true } });
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (customer?.telegramId && botToken) {
                const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: customer.telegramId,
                        text: `Buyurtmangiz yaratildi. Olib ketish uchun tasdiqlash kodi: ${code}`
                    })
                });
                telegramSent = telegramResponse.ok;
                if (!telegramSent)
                    console.error('Telegram verification code delivery failed:', await telegramResponse.text());
            }
        }
        res.status(201).json({
            success: true,
            data: { ...order, ...(code ? { verificationCode: code, telegramSent } : {}) }
        });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsulotining ombordagi qoldig‘i yetarli emas' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Ma’lumotlar bir vaqtda o‘zgardi, qayta urinib ko‘ring' });
            return;
        }
        console.error('Kassir buyurtmasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtma yaratilmadi' });
    }
});
router.post('/orders/:id/lock', async (req, res) => {
    try {
        const current = await db_1.prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, processingById: true, processingAt: true, status: true, processingBy: { select: { fullName: true } } }
        });
        if (!current) {
            res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
            return;
        }
        if ([client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI, client_1.OrderStatus.BEKOR_QILINDI, client_1.OrderStatus.QAYTARILDI].includes(current.status)) {
            res.status(409).json({ success: false, message: 'Yakunlangan buyurtmani kassaga bandlab bo‘lmaydi' });
            return;
        }
        const expired = !current.processingAt || Date.now() - current.processingAt.getTime() > 10 * 60 * 1000;
        if (current.processingById && current.processingById !== req.user.id && !expired) {
            res.status(409).json({ success: false, message: `${current.processingBy?.fullName || 'Xodim'} buyurtmani qayta ishlamoqda` });
            return;
        }
        const result = await db_1.prisma.order.updateMany({
            where: {
                id: req.params.id,
                OR: [{ processingById: null }, { processingById: req.user.id }, ...(expired ? [{ processingAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } }] : [])]
            },
            data: { processingById: req.user.id, processingAt: new Date() }
        });
        if (!result.count) {
            res.status(409).json({ success: false, message: 'Buyurtma hozir boshqa xodimda' });
            return;
        }
        (0, socket_1.emitSocketEvent)('order_processing_changed', { orderId: req.params.id, processingBy: req.user });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Buyurtmani kassirga biriktirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmani band qilib bo‘lmadi' });
    }
});
router.post('/orders/:id/unlock', async (req, res) => {
    try {
        await db_1.prisma.order.updateMany({
            where: { id: req.params.id, processingById: req.user.id },
            data: { processingById: null, processingAt: null }
        });
        (0, socket_1.emitSocketEvent)('order_processing_changed', { orderId: req.params.id, processingBy: null });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Buyurtma bandligini yechishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmani bo‘shatib bo‘lmadi' });
    }
});
router.post('/payments', async (req, res) => {
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
    const idempotencyKey = getIdempotencyKey(req.body?.idempotencyKey);
    const submitted = Array.isArray(req.body?.payments)
        ? req.body.payments
        : [{ method: req.body?.method, amount: req.body?.amountPaid, customerGiven: req.body?.customerGiven, transactionRef: req.body?.transactionRef }];
    const debtAmount = parseDecimal(req.body?.debtAmount ?? '0');
    const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : null;
    if (!orderId || !idempotencyKey || !debtAmount || submitted.length > 3 ||
        (submitted.length === 0 && debtAmount.isZero())) {
        res.status(400).json({ success: false, message: 'To‘lov ma’lumotlari noto‘g‘ri' });
        return;
    }
    const rows = submitted.map(row => ({
        method: parseMethod(row.method),
        amount: parseDecimal(row.amount),
        customerGiven: row.customerGiven === undefined ? null : parseDecimal(row.customerGiven),
        transactionRef: typeof row.transactionRef === 'string' ? row.transactionRef.trim().slice(0, 120) : null
    }));
    if (rows.some(row => !row.method || row.method === client_1.PaymentMethod.QARZ || !row.amount?.greaterThan(0) ||
        (row.customerGiven && !row.customerGiven.greaterThan(0)))) {
        res.status(400).json({ success: false, message: 'To‘lov usuli yoki summasi noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ orderId, rows: rows.map(row => ({
            method: row.method, amount: row.amount.toString(), customerGiven: row.customerGiven?.toString() || null,
            transactionRef: row.transactionRef
        })), debtAmount: debtAmount.toString(), customerId });
    try {
        const previous = await readIdempotentResult(idempotencyKey, req.user.id, 'PAYMENT', hash);
        if (previous) {
            res.json({ success: true, duplicate: true, data: previous });
            return;
        }
        const result = await db_1.prisma.$transaction(async (tx) => {
            const updatedInventoryIds = new Set();
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
            const order = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true, orderNumber: true, totalAmount: true, status: true, orderType: true,
                    customerId: true, customerName: true, customerPhone: true, processingById: true, discount: true,
                    items: { select: { id: true, quantity: true, unitPrice: true, totalPrice: true, menuItem: { select: { name: true } } } },
                    packagingItems: { select: { quantity: true, unitPrice: true, totalPrice: true, inventory: { select: { name: true, unit: true } } } },
                    payments: { select: { amount: true } },
                    debt: { select: { amount: true } },
                    table: { select: { number: true, room: { select: { name: true } } } },
                    waiter: { select: { fullName: true } },
                    customer: { select: { firstName: true, lastName: true, phone: true } }
                }
            });
            if (!order)
                throw new Error('ORDER_NOT_FOUND');
            if ([client_1.OrderStatus.BEKOR_QILINDI, client_1.OrderStatus.QAYTARILDI, client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI].includes(order.status)) {
                throw new Error('ORDER_NOT_PAYABLE');
            }
            if (order.processingById && order.processingById !== req.user.id)
                throw new Error('ORDER_LOCKED');
            const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), new client_1.Prisma.Decimal(0));
            const existingDebt = order.debt?.amount || new client_1.Prisma.Decimal(0);
            const remaining = new client_1.Prisma.Decimal(order.totalAmount).minus(paid).minus(existingDebt);
            const cashTotal = rows.filter(row => row.method === client_1.PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.amount), new client_1.Prisma.Decimal(0));
            const nonCashTotal = rows.filter(row => row.method !== client_1.PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.amount), new client_1.Prisma.Decimal(0));
            const paidNow = cashTotal.plus(nonCashTotal);
            if (paidNow.plus(debtAmount).greaterThan(remaining) || paidNow.plus(debtAmount).lessThanOrEqualTo(0)) {
                throw new Error('PAYMENT_AMOUNT_INVALID');
            }
            if (debtAmount.greaterThan(0) && !customerId && !order.customerId)
                throw new Error('CUSTOMER_REQUIRED');
            const debtCustomerId = customerId || order.customerId;
            if (debtAmount.greaterThan(0) && debtCustomerId &&
                !await tx.customer.findFirst({ where: { id: debtCustomerId, isActive: true }, select: { id: true } })) {
                throw new Error('CUSTOMER_REQUIRED');
            }
            const change = rows.filter(row => row.method === client_1.PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.customerGiven || row.amount), new client_1.Prisma.Decimal(0))
                .minus(cashTotal);
            if (change.isNegative())
                throw new Error('CASH_INSUFFICIENT');
            const createdPayments = [];
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                const cashChange = row.method === client_1.PaymentMethod.NAQD && index === rows.findIndex(item => item.method === client_1.PaymentMethod.NAQD)
                    ? change : new client_1.Prisma.Decimal(0);
                createdPayments.push(await tx.payment.create({
                    data: {
                        orderId,
                        cashierId: req.user.id,
                        method: row.method,
                        amount: row.amount,
                        ...(row.method === client_1.PaymentMethod.NAQD ? { customerGiven: row.customerGiven || row.amount.plus(cashChange), changeAmount: cashChange } : {}),
                        ...(row.transactionRef ? { transactionRef: row.transactionRef } : {}),
                        idempotencyKey: `${idempotencyKey}_${index}`
                    },
                    select: { id: true, method: true, amount: true, changeAmount: true }
                }));
                if (row.method === client_1.PaymentMethod.NAQD) {
                    await addCashMovement(tx, req.user.id, 'SALE', row.amount, orderId);
                }
            }
            let debt = null;
            if (debtAmount.greaterThan(0) && debtCustomerId) {
                const currentDebt = await tx.customerDebt.findUnique({ where: { orderId } });
                debt = currentDebt
                    ? await tx.customerDebt.update({
                        where: { id: currentDebt.id },
                        data: { amount: currentDebt.amount.plus(debtAmount), remaining: currentDebt.remaining.plus(debtAmount) }
                    })
                    : await tx.customerDebt.create({
                        data: { customerId: debtCustomerId, orderId, amount: debtAmount, remaining: debtAmount, createdById: req.user.id }
                    });
            }
            const totalPaid = paid.plus(paidNow);
            const fullySettled = totalPaid.plus(existingDebt).plus(debtAmount).equals(order.totalAmount);
            const status = fullySettled && existingDebt.isZero() && debtAmount.isZero()
                ? client_1.OrderStatus.TOLANDI : client_1.OrderStatus.QISMAN_TOLANDI;
            const updated = await tx.order.update({
                where: { id: orderId },
                data: {
                    status,
                    ...(status === client_1.OrderStatus.TOLANDI ? { paidAt: new Date() } : {}),
                    processingById: null,
                    processingAt: null,
                    ...(debtCustomerId && !order.customerId ? { customerId: debtCustomerId } : {}),
                    statusHistory: { create: { status, userId: req.user.id, comment: `Kassir to‘lovi: ${paidNow.toString()}` } }
                },
                select: { id: true, orderNumber: true, status: true, totalAmount: true, orderType: true }
            });
            if (status === client_1.OrderStatus.TOLANDI && order.orderType === client_1.OrderType.DINE_IN) {
                await (0, order_packaging_1.deductPackaging)(tx, orderId, req.user.id);
            }
            if (status === client_1.OrderStatus.TOLANDI) {
                for (const id of await (0, order_recipes_1.deductOrderRecipes)(tx, orderId, req.user.id))
                    updatedInventoryIds.add(id);
            }
            const receiptNumber = `${order.orderNumber}-${Date.now()}-${(0, crypto_1.randomBytes)(2).toString('hex').toUpperCase()}`;
            const receipt = await tx.receipt.create({
                data: { orderId, receiptNumber, qrHash: (0, crypto_1.createHash)('sha256').update((0, crypto_1.randomBytes)(32)).digest('hex') }
            });
            const printPayload = {
                restaurantName: 'ChoyxonaAzizxon',
                receiptNumber,
                orderNumber: order.orderNumber,
                orderType: order.orderType,
                table: order.table ? `${order.table.room.name} / ${order.table.number}` : null,
                customer: order.customer
                    ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
                    : order.customerName,
                customerPhone: order.customer?.phone || order.customerPhone,
                waiter: order.waiter?.fullName || null,
                cashier: req.user.fullName,
                createdAt: new Date().toISOString(),
                items: order.items.map(item => ({ name: item.menuItem.name, quantity: item.quantity.toString(), amount: item.totalPrice.toString() })),
                packaging: order.packagingItems.map(item => ({ name: item.inventory.name, quantity: item.quantity.toString(), unit: item.inventory.unit, amount: item.totalPrice.toString() })),
                total: order.totalAmount.toString(),
                discount: order.discount.toString(),
                payments: createdPayments.map(payment => ({ method: payment.method, amount: payment.amount.toString() })),
                debt: existingDebt.plus(debtAmount).toString(),
                change: change.toString()
            };
            await tx.printJob.create({
                data: { orderId, payload: JSON.stringify(printPayload), status: 'KUTILMOQDA', jobType: 'RECEIPT' }
            });
            await writeAudit(tx, req.user.id, 'PAYMENT_RECEIVED', 'Order', orderId, {
                paymentIds: createdPayments.map(payment => payment.id), amount: paidNow.toString(), debt: debtAmount.toString()
            });
            if (debt)
                await writeAudit(tx, req.user.id, 'DEBT_CREATED', 'CustomerDebt', debt.id, { amount: debtAmount.toString() });
            const response = { order: updated, payments: createdPayments, debtAmount: debtAmount.toString(), change: change.toString(), receipt };
            await saveIdempotentResult(tx, idempotencyKey, req.user.id, 'PAYMENT', hash, orderId, response);
            return { response, updatedInventoryIds: [...updatedInventoryIds] };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('paymentReceived', { orderId, status: result.response.order.status });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId, status: result.response.order.status });
        if (result.updatedInventoryIds.length)
            (0, socket_1.emitSocketEvent)('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.json({ success: true, data: result.response });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldig‘i yetarli emas` });
            return;
        }
        const knownErrors = {
            ORDER_NOT_FOUND: { status: 404, message: 'Buyurtma topilmadi' },
            ORDER_NOT_PAYABLE: { status: 409, message: 'Buyurtmani to‘lab bo‘lmaydi' },
            ORDER_LOCKED: { status: 409, message: 'Buyurtma boshqa xodim tomonidan qayta ishlanmoqda' },
            PAYMENT_AMOUNT_INVALID: { status: 400, message: 'To‘lov va qarz summasi qoldiq summaga mos emas' },
            CUSTOMER_REQUIRED: { status: 400, message: 'Qarz uchun mijozni tanlang' },
            CASH_INSUFFICIENT: { status: 400, message: 'Mijoz bergan naqd pul yetarli emas' },
            IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' }
        };
        if (error instanceof Error && knownErrors[error.message]) {
            const result = knownErrors[error.message];
            res.status(result.status).json({ success: false, message: result.message });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
            res.status(409).json({ success: false, message: 'To‘lov allaqachon yuborilgan yoki ma’lumotlar yangilandi. Sahifani yangilang.' });
            return;
        }
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsuloti qoldig‘i yetarli emas' });
            return;
        }
        console.error('Kassir to‘lovini yozishda xatolik:', error);
        res.status(500).json({ success: false, message: 'To‘lovni amalga oshirib bo‘lmadi' });
    }
});
router.get('/payments', async (req, res) => {
    try {
        const payments = await db_1.prisma.payment.findMany({
            where: req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {},
            include: {
                cashier: { select: { fullName: true } },
                order: { select: { id: true, orderNumber: true, orderType: true, customerName: true, table: { select: { number: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 250
        });
        res.json({ success: true, data: payments });
    }
    catch (error) {
        console.error('To‘lovlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'To‘lovlar tarixini olib bo‘lmadi' });
    }
});
router.get('/customers', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
        res.json({ success: true, data: [] });
        return;
    }
    const digits = query.replace(/\D/g, '');
    const customerNumber = Number(query.replace(/^#/, ''));
    try {
        const customers = await db_1.prisma.customer.findMany({
            where: {
                isActive: true,
                OR: [
                    { firstName: { contains: query, mode: 'insensitive' } },
                    { lastName: { contains: query, mode: 'insensitive' } },
                    ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
                    ...(Number.isSafeInteger(customerNumber) && customerNumber > 0 ? [{ customerNumber }] : [])
                ]
            },
            select: {
                id: true, customerNumber: true, firstName: true, lastName: true, phone: true,
                _count: { select: { orders: true } },
                orders: { select: { totalAmount: true, status: true }, where: { status: { in: [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI, client_1.OrderStatus.QAYTARILDI] } } },
                debts: { select: { remaining: true } }
            },
            take: 30,
            orderBy: { customerNumber: 'asc' }
        });
        res.json({
            success: true,
            data: customers.map(customer => ({
                id: customer.id,
                customerNumber: customer.customerNumber,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phoneMasked: customer.phone ? customer.phone.replace(/(\+?\d{3})\D*(\d{2})\D*\d{3}\D*(\d{2})\D*(\d{2})/, '$1 $2 *** ** $4') : null,
                visits: customer._count.orders,
                purchases: customer.orders.reduce((sum, order) => sum.plus(order.totalAmount), new client_1.Prisma.Decimal(0)).toString(),
                debt: customer.debts.reduce((sum, debt) => sum.plus(debt.remaining), new client_1.Prisma.Decimal(0)).toString()
            }))
        });
    }
    catch (error) {
        console.error('Mijozlarni qidirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijozlarni qidirib bo‘lmadi' });
    }
});
router.post('/customers', async (req, res) => {
    const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim().slice(0, 80) : '';
    const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim().slice(0, 80) : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 40) : '';
    const phoneDigits = phone.replace(/\D/g, '');
    if (!firstName || !phoneDigits || phoneDigits.length < 7) {
        res.status(400).json({ success: false, message: 'Mijoz ismi va to‘g‘ri telefon raqami kerak' });
        return;
    }
    try {
        const customer = await db_1.prisma.customer.create({
            data: { firstName, lastName, phone, phoneDigits },
            select: { id: true, customerNumber: true, firstName: true, lastName: true, phone: true }
        });
        res.status(201).json({ success: true, data: customer });
    }
    catch (error) {
        console.error('Mijoz yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijozni yaratib bo‘lmadi' });
    }
});
router.get('/customers/:id', async (req, res) => {
    try {
        const customer = await db_1.prisma.customer.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, customerNumber: true, firstName: true, lastName: true, phone: true, notes: true, createdAt: true,
                orders: { select: { id: true, orderNumber: true, orderType: true, status: true, totalAmount: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 },
                debts: { select: { id: true, amount: true, remaining: true, createdAt: true, closedAt: true, order: { select: { orderNumber: true } }, payments: { select: { amount: true, method: true, createdAt: true, cashier: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' } }
            }
        });
        if (!customer) {
            res.status(404).json({ success: false, message: 'Mijoz topilmadi' });
            return;
        }
        res.json({ success: true, data: customer });
    }
    catch (error) {
        console.error('Mijoz kartasini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijoz ma’lumotlarini olib bo‘lmadi' });
    }
});
router.patch('/customers/:id', (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const status = req.body?.status;
    if (status !== undefined && !['YANGI', 'DOIMIY', 'VIP', 'ODDIY'].includes(status)) {
        res.status(400).json({ success: false, message: 'Mijoz holati noto‘g‘ri' });
        return;
    }
    const data = {};
    if (typeof req.body?.firstName === 'string' && req.body.firstName.trim())
        data.firstName = req.body.firstName.trim().slice(0, 80);
    if (typeof req.body?.lastName === 'string')
        data.lastName = req.body.lastName.trim().slice(0, 80);
    if (typeof req.body?.phone === 'string') {
        data.phone = req.body.phone.trim().slice(0, 40);
        data.phoneDigits = req.body.phone.replace(/\D/g, '');
    }
    if (typeof req.body?.notes === 'string')
        data.notes = req.body.notes.trim().slice(0, 1000);
    if (typeof status === 'string')
        data.status = status;
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'Yangilash uchun ma’lumot kiriting' });
        return;
    }
    try {
        const customer = await db_1.prisma.$transaction(async (tx) => {
            const updated = await tx.customer.update({ where: { id: req.params.id }, data });
            await writeAudit(tx, req.user.id, 'CUSTOMER_UPDATED', 'Customer', updated.id, { fields: Object.keys(data) });
            return updated;
        });
        res.json({ success: true, data: { id: customer.id, customerNumber: customer.customerNumber, firstName: customer.firstName, lastName: customer.lastName, status: customer.status } });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            res.status(404).json({ success: false, message: 'Mijoz topilmadi' });
            return;
        }
        console.error('Mijoz ma’lumotlarini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijoz ma’lumotlarini yangilab bo‘lmadi' });
    }
});
router.get('/debts', async (req, res) => {
    try {
        const debts = await db_1.prisma.customerDebt.findMany({
            where: { remaining: { gt: 0 } },
            select: {
                id: true, amount: true, remaining: true, createdAt: true,
                customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true, phone: true } },
                order: { select: { id: true, orderNumber: true, orderType: true } },
                createdBy: { select: { fullName: true } },
                payments: { select: { amount: true, method: true, createdAt: true, cashier: { select: { fullName: true } } } }
            },
            orderBy: { createdAt: 'asc' },
            take: 500
        });
        res.json({ success: true, data: debts });
    }
    catch (error) {
        console.error('Qarzlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qarzlar tarixini olib bo‘lmadi' });
    }
});
router.post('/debts/:id/payments', async (req, res) => {
    const amount = parseDecimal(req.body?.amount);
    const method = parseMethod(req.body?.method);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!amount?.greaterThan(0) || !method || method === client_1.PaymentMethod.QARZ || !key) {
        res.status(400).json({ success: false, message: 'Qarz to‘lovi ma’lumotlari noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ debtId: req.params.id, amount: amount.toString(), method });
    try {
        const duplicate = await readIdempotentResult(key, req.user.id, 'DEBT_PAYMENT', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const result = await db_1.prisma.$transaction(async (tx) => {
            const updatedInventoryIds = new Set();
            await tx.$queryRaw `SELECT "id" FROM "CustomerDebt" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const debt = await tx.customerDebt.findUnique({ where: { id: req.params.id } });
            if (!debt || debt.remaining.lessThan(amount))
                throw new Error('DEBT_PAYMENT_INVALID');
            const order = await tx.order.findUnique({
                where: { id: debt.orderId },
                select: {
                    id: true, orderNumber: true, status: true, orderType: true, totalAmount: true,
                    customerName: true, customerPhone: true,
                    customer: { select: { firstName: true, lastName: true, phone: true } },
                    table: { select: { number: true, room: { select: { name: true } } } },
                    items: { select: { quantity: true, totalPrice: true, menuItem: { select: { name: true } } } },
                    payments: { select: { amount: true } },
                    refunds: { select: { amount: true } }
                }
            });
            if (!order)
                throw new Error('DEBT_PAYMENT_INVALID');
            let settledOrderId = null;
            const payment = await tx.debtPayment.create({
                data: {
                    customerId: debt.customerId,
                    debtId: debt.id,
                    cashierId: req.user.id,
                    amount,
                    method,
                    idempotencyKey: key
                }
            });
            const remaining = debt.remaining.minus(amount);
            const updated = await tx.customerDebt.update({
                where: { id: debt.id },
                data: { remaining, ...(remaining.isZero() ? { closedAt: new Date() } : {}) }
            });
            if (remaining.isZero()) {
                if (order.status === client_1.OrderStatus.QISMAN_TOLANDI || order.status === client_1.OrderStatus.TOLOV_KUTILMOQDA) {
                    const paid = order.payments.reduce((sum, item) => sum.plus(item.amount), new client_1.Prisma.Decimal(0));
                    const refunded = order.refunds.reduce((sum, item) => sum.plus(item.amount), new client_1.Prisma.Decimal(0));
                    if (paid.minus(refunded).plus(debt.amount).equals(order.totalAmount)) {
                        await tx.order.update({
                            where: { id: order.id },
                            data: {
                                status: client_1.OrderStatus.TOLANDI,
                                paidAt: new Date(),
                                statusHistory: { create: { status: client_1.OrderStatus.TOLANDI, userId: req.user.id, comment: 'Qarz to‘liq to‘landi' } }
                            }
                        });
                        settledOrderId = order.id;
                        if (order.orderType === client_1.OrderType.DINE_IN)
                            await (0, order_packaging_1.deductPackaging)(tx, order.id, req.user.id);
                        for (const id of await (0, order_recipes_1.deductOrderRecipes)(tx, order.id, req.user.id))
                            updatedInventoryIds.add(id);
                    }
                }
            }
            const receiptNumber = `${order.orderNumber}-D${Date.now()}-${(0, crypto_1.randomBytes)(2).toString('hex').toUpperCase()}`;
            const receipt = await tx.receipt.create({
                data: { orderId: order.id, receiptNumber, qrHash: (0, crypto_1.createHash)('sha256').update((0, crypto_1.randomBytes)(32)).digest('hex') }
            });
            const printPayload = {
                restaurantName: 'ChoyxonaAzizxon',
                receiptNumber,
                orderNumber: order.orderNumber,
                customer: order.customer
                    ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
                    : order.customerName,
                customerPhone: order.customer?.phone || order.customerPhone,
                table: order.table ? `${order.table.room.name} / ${order.table.number}` : null,
                cashier: req.user.fullName,
                createdAt: new Date().toISOString(),
                items: order.items.map(item => ({ name: item.menuItem.name, quantity: item.quantity.toString(), amount: item.totalPrice.toString() })),
                total: amount.toString(),
                orderTotal: order.totalAmount.toString(),
                payment: { method, amount: amount.toString() },
                debtRemaining: updated.remaining.toString()
            };
            await tx.printJob.create({
                data: { orderId: order.id, payload: JSON.stringify(printPayload), status: 'KUTILMOQDA', jobType: 'RECEIPT' }
            });
            if (method === client_1.PaymentMethod.NAQD)
                await addCashMovement(tx, req.user.id, 'DEBT_PAYMENT', amount, debt.id);
            await writeAudit(tx, req.user.id, 'DEBT_PAYMENT_RECEIVED', 'CustomerDebt', debt.id, { amount: amount.toString(), method });
            const response = { payment, remaining: updated.remaining.toString(), receipt };
            await saveIdempotentResult(tx, key, req.user.id, 'DEBT_PAYMENT', hash, debt.id, response);
            return { response, settledOrderId, updatedInventoryIds: [...updatedInventoryIds] };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('debtUpdated', { debtId: req.params.id });
        if (result.settledOrderId) {
            (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: result.settledOrderId, status: client_1.OrderStatus.TOLANDI });
            (0, socket_1.emitSocketEvent)('paymentReceived', { orderId: result.settledOrderId, status: client_1.OrderStatus.TOLANDI });
        }
        if (result.updatedInventoryIds.length)
            (0, socket_1.emitSocketEvent)('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.status(201).json({ success: true, data: result.response });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldig‘i yetarli emas` });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof Error && error.message === 'DEBT_PAYMENT_INVALID') {
            res.status(409).json({ success: false, message: 'Qarz topilmadi yoki to‘lov qoldiqdan ko‘p' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Qarz to‘lovi allaqachon yuborilgan yoki yangilandi' });
            return;
        }
        console.error('Qarz to‘lovini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qarz to‘lovini saqlab bo‘lmadi' });
    }
});
router.post('/refunds', async (req, res) => {
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const items = req.body?.items;
    const method = parseMethod(req.body?.method || 'NAQD');
    if (!key || !orderId || !reason || !method || method === client_1.PaymentMethod.QARZ || !Array.isArray(items) ||
        !items.length || new Set(items.map(item => item.orderItemId)).size !== items.length ||
        items.some(item => typeof item.orderItemId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0))) {
        res.status(400).json({ success: false, message: 'Qaytarish ma’lumotlari noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ orderId, reason, method, items });
    try {
        const duplicate = await readIdempotentResult(key, req.user.id, 'REFUND', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const threshold = parseDecimal(process.env.REFUND_ADMIN_APPROVAL_THRESHOLD || '500000');
        const refund = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
            const order = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true, status: true, debt: { select: { remaining: true, payments: { select: { amount: true } } } },
                    payments: { select: { amount: true } },
                    items: { select: { id: true, quantity: true, unitPrice: true } },
                    refunds: { select: { amount: true } }
                }
            });
            if (!order || [client_1.OrderStatus.BEKOR_QILINDI].includes(order.status))
                throw new Error('REFUND_ORDER_INVALID');
            if (order.debt?.remaining.greaterThan(0))
                throw new Error('REFUND_OUTSTANDING_DEBT');
            const selectedIds = items.map(item => item.orderItemId);
            const orderItems = new Map(order.items.filter(item => selectedIds.includes(item.id)).map(item => [item.id, item]));
            if (orderItems.size !== new Set(selectedIds).size)
                throw new Error('REFUND_ITEM_INVALID');
            const lineData = [];
            let total = new client_1.Prisma.Decimal(0);
            for (const item of items) {
                const orderItem = orderItems.get(item.orderItemId);
                const quantity = parseDecimal(item.quantity, quantityPattern);
                const previouslyReturned = await tx.refundItem.aggregate({
                    where: { orderItemId: orderItem.id },
                    _sum: { quantity: true }
                });
                if (new client_1.Prisma.Decimal(previouslyReturned._sum.quantity || 0).plus(quantity).greaterThan(orderItem.quantity)) {
                    throw new Error('REFUND_QUANTITY_EXCEEDED');
                }
                const amount = new client_1.Prisma.Decimal(orderItem.unitPrice).mul(quantity);
                total = total.plus(amount);
                lineData.push({ orderItemId: orderItem.id, quantity, amount });
            }
            const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), new client_1.Prisma.Decimal(0))
                .plus(order.debt?.payments.reduce((sum, payment) => sum.plus(payment.amount), new client_1.Prisma.Decimal(0)) || new client_1.Prisma.Decimal(0));
            const alreadyRefunded = order.refunds.reduce((sum, previous) => sum.plus(previous.amount), new client_1.Prisma.Decimal(0));
            if (total.greaterThan(paid.minus(alreadyRefunded)))
                throw new Error('REFUND_AMOUNT_EXCEEDED');
            if (req.user.role !== client_1.RoleType.ADMIN && total.greaterThan(threshold))
                throw new Error('ADMIN_APPROVAL_REQUIRED');
            const created = await tx.refund.create({
                data: {
                    orderId,
                    amount: total,
                    reason,
                    method,
                    cashierId: req.user.id,
                    ...(req.user.role === client_1.RoleType.ADMIN ? { approvedById: req.user.id } : {}),
                    idempotencyKey: key,
                    items: { create: lineData }
                },
                include: { items: true }
            });
            if (method === client_1.PaymentMethod.NAQD)
                await addCashMovement(tx, req.user.id, 'REFUND', total.negated(), orderId, reason);
            const refundedTotal = alreadyRefunded.plus(total);
            const fullyRefunded = refundedTotal.equals(paid);
            if (fullyRefunded) {
                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        status: client_1.OrderStatus.QAYTARILDI,
                        statusHistory: { create: { status: client_1.OrderStatus.QAYTARILDI, userId: req.user.id, comment: reason } }
                    }
                });
            }
            await writeAudit(tx, req.user.id, 'ORDER_REFUNDED', 'Refund', created.id, { amount: total.toString(), orderId, reason });
            const response = { ...created, amount: created.amount.toString() };
            await saveIdempotentResult(tx, key, req.user.id, 'REFUND', hash, created.id, response);
            return created;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId, type: 'refund' });
        res.status(201).json({ success: true, data: refund });
    }
    catch (error) {
        const messages = {
            IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' },
            REFUND_ORDER_INVALID: { status: 400, message: 'Buyurtmani qaytarib bo‘lmaydi' },
            REFUND_OUTSTANDING_DEBT: { status: 409, message: 'Qarz to‘lanmaguncha buyurtmani qaytarib bo‘lmaydi' },
            REFUND_ITEM_INVALID: { status: 400, message: 'Buyurtma taomi topilmadi' },
            REFUND_QUANTITY_EXCEEDED: { status: 409, message: 'Qaytarilgan miqdor buyurtma miqdoridan oshdi' },
            REFUND_AMOUNT_EXCEEDED: { status: 409, message: 'Qaytarish summasi olingan to‘lovdan oshdi' },
            ADMIN_APPROVAL_REQUIRED: { status: 403, message: 'Bu summa uchun Admin tasdig‘i kerak' }
        };
        if (error instanceof Error && messages[error.message]) {
            const entry = messages[error.message];
            res.status(entry.status).json({ success: false, message: entry.message });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Qaytarish allaqachon yuborilgan yoki buyurtma yangilandi' });
            return;
        }
        console.error('Buyurtmani qaytarishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qaytarishni saqlab bo‘lmadi' });
    }
});
router.get('/expenses', async (req, res) => {
    try {
        const expenses = await db_1.prisma.expense.findMany({
            where: req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {},
            include: { cashier: { select: { fullName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 250
        });
        res.json({ success: true, data: expenses });
    }
    catch (error) {
        console.error('Xarajatlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xarajatlar tarixini olib bo‘lmadi' });
    }
});
router.post('/expenses', async (req, res) => {
    const amount = parseDecimal(req.body?.amount);
    const method = parseMethod(req.body?.method || 'NAQD');
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 80) : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : '';
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!amount?.greaterThan(0) || !method || method === client_1.PaymentMethod.QARZ || !category || !description || !key) {
        res.status(400).json({ success: false, message: 'Xarajat ma’lumotlari noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ amount: amount.toString(), method, category, description });
    try {
        const duplicate = await readIdempotentResult(key, req.user.id, 'EXPENSE', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const expense = await db_1.prisma.$transaction(async (tx) => {
            const session = method === client_1.PaymentMethod.NAQD ? await openSession(tx, req.user.id) : null;
            const created = await tx.expense.create({
                data: {
                    amount, method, category, description, cashierId: req.user.id,
                    ...(session ? { sessionId: session.id } : {})
                }
            });
            if (method === client_1.PaymentMethod.NAQD)
                await addCashMovement(tx, req.user.id, 'EXPENSE', amount.negated(), created.id, description);
            await writeAudit(tx, req.user.id, 'EXPENSE_CREATED', 'Expense', created.id, { amount: amount.toString(), category });
            await saveIdempotentResult(tx, key, req.user.id, 'EXPENSE', hash, created.id, created);
            return created;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('cashMovement', { type: 'EXPENSE', expenseId: expense.id });
        res.status(201).json({ success: true, data: expense });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Xarajat allaqachon yuborilgan yoki ma’lumot yangilandi' });
            return;
        }
        console.error('Xarajatni saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xarajatni saqlab bo‘lmadi' });
    }
});
router.get('/register', async (req, res) => {
    try {
        const session = await db_1.prisma.cashSession.findFirst({
            where: { cashierId: req.user.id, activeCashierId: req.user.id },
            include: { movements: { orderBy: { createdAt: 'desc' }, take: 100 } }
        });
        const expected = session ? await db_1.prisma.cashMovement.aggregate({
            where: { sessionId: session.id },
            _sum: { amount: true }
        }) : null;
        res.json({
            success: true,
            data: session ? { ...session, currentExpected: (expected?._sum.amount || new client_1.Prisma.Decimal(0)).toString() } : null
        });
    }
    catch (error) {
        console.error('Kassa smenasini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa smenasini olib bo‘lmadi' });
    }
});
router.post('/register/open', async (req, res) => {
    const startingBalance = parseDecimal(req.body?.startingBalance);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!startingBalance || !key || (req.body?.terminalId !== undefined &&
        (typeof req.body.terminalId !== 'string' || req.body.terminalId.length > 100))) {
        res.status(400).json({ success: false, message: 'Boshlang‘ich kassa summasi noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ startingBalance: startingBalance.toString(), terminalId: req.body?.terminalId || null });
    try {
        const duplicate = await readIdempotentResult(key, req.user.id, 'REGISTER_OPEN', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const session = await db_1.prisma.$transaction(async (tx) => {
            const active = await openSession(tx, req.user.id);
            if (active)
                throw new Error('REGISTER_ALREADY_OPEN');
            const created = await tx.cashSession.create({
                data: {
                    cashierId: req.user.id,
                    activeCashierId: req.user.id,
                    startingBalance,
                    ...(req.body?.terminalId ? { terminalId: req.body.terminalId } : {})
                }
            });
            await tx.cashMovement.create({ data: { sessionId: created.id, userId: req.user.id, type: 'OPENING', amount: startingBalance } });
            await writeAudit(tx, req.user.id, 'REGISTER_OPENED', 'CashSession', created.id, { startingBalance: startingBalance.toString() });
            await saveIdempotentResult(tx, key, req.user.id, 'REGISTER_OPEN', hash, created.id, created);
            return created;
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('cashRegisterUpdated', { cashierId: req.user.id, status: 'OPEN' });
        res.status(201).json({ success: true, data: session });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'REGISTER_ALREADY_OPEN') {
            res.status(409).json({ success: false, message: 'Kassa allaqachon ochiq' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Faol kassa smenasi allaqachon mavjud' });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Kassa smenasi bir vaqtda o‘zgardi' });
            return;
        }
        console.error('Kassani ochishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassani ochib bo‘lmadi' });
    }
});
router.post('/register/close', async (req, res) => {
    const actualCash = parseDecimal(req.body?.actualCash);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!actualCash || !key) {
        res.status(400).json({ success: false, message: 'Amaldagi kassa summasi noto‘g‘ri' });
        return;
    }
    const hash = requestHash({ actualCash: actualCash.toString(), closingNote: req.body?.closingNote || '' });
    try {
        const duplicate = await readIdempotentResult(key, req.user.id, 'REGISTER_CLOSE', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const result = await db_1.prisma.$transaction(async (tx) => {
            const session = await tx.cashSession.findFirst({
                where: { cashierId: req.user.id, activeCashierId: req.user.id }
            });
            if (!session)
                throw new Error('REGISTER_NOT_OPEN');
            await tx.$queryRaw `SELECT "id" FROM "CashSession" WHERE "id" = ${session.id} FOR UPDATE`;
            const aggregate = await tx.cashMovement.aggregate({
                where: { sessionId: session.id },
                _sum: { amount: true }
            });
            const expectedCash = new client_1.Prisma.Decimal(aggregate._sum.amount || 0);
            const difference = actualCash.minus(expectedCash);
            const closed = await tx.cashSession.update({
                where: { id: session.id },
                data: {
                    expectedCash,
                    actualCash,
                    difference,
                    closingNote: typeof req.body?.closingNote === 'string' ? req.body.closingNote.trim().slice(0, 500) : null,
                    closedAt: new Date(),
                    activeCashierId: null
                }
            });
            await writeAudit(tx, req.user.id, 'REGISTER_CLOSED', 'CashSession', session.id, {
                actualCash: actualCash.toString(), expectedCash: expectedCash.toString(), difference: difference.toString()
            });
            await tx.cashMovement.create({
                data: { sessionId: session.id, userId: req.user.id, type: 'CLOSING', amount: actualCash, referenceId: session.id }
            });
            const response = { expectedCash: expectedCash.toString(), actualCash: actualCash.toString(), difference: difference.toString(), sessionId: session.id };
            await saveIdempotentResult(tx, key, req.user.id, 'REGISTER_CLOSE', hash, session.id, response);
            return { closed, ...response };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        (0, socket_1.emitSocketEvent)('cashRegisterUpdated', { cashierId: req.user.id, status: 'CLOSED' });
        res.json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'REGISTER_NOT_OPEN') {
            res.status(409).json({ success: false, message: 'Ochiq kassa smenasi topilmadi' });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'So‘rov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Kassa smenasi bir vaqtda o‘zgardi' });
            return;
        }
        console.error('Kassani yopishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassani yopib bo‘lmadi' });
    }
});
router.get('/history', async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : dayStartInTashkent();
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        res.status(400).json({ success: false, message: 'Sana oralig‘i noto‘g‘ri' });
        return;
    }
    try {
        const where = {
            createdAt: { gte: from, lte: to },
            ...(req.user.role === client_1.RoleType.CASHIER ? { userId: req.user.id } : {})
        };
        const [movements, sessions] = await Promise.all([
            db_1.prisma.cashMovement.findMany({ where, include: { user: { select: { fullName: true, role: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
            db_1.prisma.cashSession.findMany({
                where: { openedAt: { gte: from, lte: to }, ...(req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {}) },
                select: { id: true, startingBalance: true, expectedCash: true, actualCash: true, difference: true, openedAt: true, closedAt: true, cashier: { select: { fullName: true } } },
                orderBy: { openedAt: 'desc' },
                take: 200
            })
        ]);
        res.json({ success: true, data: { movements, sessions } });
    }
    catch (error) {
        console.error('Kassa tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa tarixini olib bo‘lmadi' });
    }
});
router.get('/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    if (query.length < 2) {
        res.json({ success: true, data: [] });
        return;
    }
    const digits = query.replace(/\D/g, '');
    const number = Number(query.replace(/^#/, ''));
    try {
        const [orders, customers] = await Promise.all([
            db_1.prisma.order.findMany({
                where: {
                    OR: [
                        { orderNumber: { contains: query, mode: 'insensitive' } },
                        { table: { number: { contains: query, mode: 'insensitive' } } },
                        { waiter: { fullName: { contains: query, mode: 'insensitive' } } },
                        { customerName: { contains: query, mode: 'insensitive' } },
                        { customerPhone: { contains: digits || query } }
                    ]
                },
                select: {
                    id: true, orderNumber: true, status: true, orderType: true, source: true, totalAmount: true, createdAt: true,
                    table: { select: { number: true, room: { select: { name: true } } } },
                    customer: { select: { customerNumber: true, firstName: true, lastName: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: 30
            }),
            db_1.prisma.customer.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { firstName: { contains: query, mode: 'insensitive' } },
                        { lastName: { contains: query, mode: 'insensitive' } },
                        ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
                        ...(Number.isSafeInteger(number) && number > 0 ? [{ customerNumber: number }] : [])
                    ]
                },
                select: { id: true, customerNumber: true, firstName: true, lastName: true, phone: true },
                take: 30
            })
        ]);
        res.json({
            success: true,
            data: [
                ...orders.map(order => ({ kind: 'ORDER', ...order })),
                ...customers.map(customer => ({
                    kind: 'CUSTOMER',
                    ...customer,
                    phone: customer.phone ? customer.phone.replace(/(\+?\d{3})\D*(\d{2})\D*\d{3}\D*(\d{2})\D*(\d{2})/, '$1 $2 *** ** $4') : null
                }))
            ]
        });
    }
    catch (error) {
        console.error('Kassa umumiy qidiruvida xatolik:', error);
        res.status(500).json({ success: false, message: 'Qidiruvni bajarib bo‘lmadi' });
    }
});
router.get('/orders/:id/timeline', async (req, res) => {
    try {
        const order = await db_1.prisma.order.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, orderNumber: true, orderType: true, source: true, status: true, createdAt: true,
                statusHistory: {
                    include: { user: { select: { fullName: true, role: true } } },
                    orderBy: { createdAt: 'asc' }
                },
                payments: { select: { id: true, amount: true, method: true, cashier: { select: { fullName: true, role: true } }, createdAt: true } },
                refunds: { select: { id: true, amount: true, reason: true, cashier: { select: { fullName: true } }, approvedBy: { select: { fullName: true } }, createdAt: true } },
                createdBy: { select: { fullName: true, role: true } },
                waiter: { select: { fullName: true, role: true } },
                customer: { select: { customerNumber: true, firstName: true, lastName: true } }
            }
        });
        if (!order) {
            res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
            return;
        }
        const entries = [
            ...order.statusHistory.map(item => ({
                at: item.createdAt, action: item.status, employee: item.user?.fullName || null,
                role: item.user?.role || null, details: item.comment
            })),
            ...order.payments.map(item => ({
                at: item.createdAt, action: 'TO‘LOV', employee: item.cashier.fullName, role: item.cashier.role, details: `${item.amount} ${item.method}`
            })),
            ...order.refunds.map(item => ({
                at: item.createdAt, action: 'QAYTARISH', employee: item.cashier.fullName, role: client_1.RoleType.CASHIER, details: `${item.amount} so‘m — ${item.reason}`
            })),
            ...(order.createdBy ? [{
                    at: order.createdAt, action: 'ORDER_SOURCE', employee: order.createdBy.fullName, role: order.createdBy.role, details: order.source
                }] : [])
        ].sort((left, right) => left.at.getTime() - right.at.getTime());
        res.json({ success: true, data: { order, entries } });
    }
    catch (error) {
        console.error('Buyurtma tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtma tarixini olib bo‘lmadi' });
    }
});
router.get('/waiter-calls', async (_req, res) => {
    try {
        const calls = await db_1.prisma.waiterCall.findMany({
            where: { status: { not: 'YAKUNLANDI' }, kind: 'CASHIER_ASSIST' },
            include: {
                table: { select: { number: true, room: { select: { name: true } } } },
                calledBy: { select: { fullName: true, role: true } }
            },
            orderBy: { createdAt: 'asc' },
            take: 100
        });
        res.json({ success: true, data: calls });
    }
    catch (error) {
        console.error('Ofitsiant chaqiruvlarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruvlarni olib bo‘lmadi' });
    }
});
router.post('/waiter-calls/:id/status', async (req, res) => {
    const next = req.body?.status;
    if (!['QABUL_QILINDI', 'YAKUNLANDI'].includes(next)) {
        res.status(400).json({ success: false, message: 'Chaqiruv holati noto‘g‘ri' });
        return;
    }
    try {
        const call = await db_1.prisma.waiterCall.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
        if (!call || call.status === 'YAKUNLANDI') {
            res.status(404).json({ success: false, message: 'Faol chaqiruv topilmadi' });
            return;
        }
        const updated = await db_1.prisma.waiterCall.update({
            where: { id: call.id },
            data: next === 'QABUL_QILINDI'
                ? { status: next, acceptedById: req.user.id }
                : { status: next, completedById: req.user.id }
        });
        await db_1.prisma.auditLog.create({
            data: { userId: req.user.id, action: `WAITER_CALL_${next}`, entity: 'WaiterCall', entityId: call.id }
        });
        (0, socket_1.emitSocketEvent)('waiter_call_updated', { callId: call.id, status: updated.status });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        console.error('Ofitsiant chaqiruvini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruv holatini yangilab bo‘lmadi' });
    }
});
router.get('/reports', async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : dayStartInTashkent();
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        res.status(400).json({ success: false, message: 'Hisobot sanalari noto‘g‘ri' });
        return;
    }
    const cashierFilter = req.user.role === client_1.RoleType.CASHIER ? { cashierId: req.user.id } : {};
    try {
        const [payments, expenses, refunds, debts, debtPayments, orders] = await Promise.all([
            db_1.prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            db_1.prisma.expense.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            db_1.prisma.refund.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            db_1.prisma.customerDebt.aggregate({ where: { createdAt: { gte: from, lte: to }, ...(req.user.role === client_1.RoleType.CASHIER ? { createdById: req.user.id } : {}) }, _sum: { amount: true } }),
            db_1.prisma.debtPayment.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            db_1.prisma.order.groupBy({ by: ['orderType'], where: { createdAt: { gte: from, lte: to }, ...(req.user.role === client_1.RoleType.CASHIER ? { createdById: req.user.id } : {}) }, _count: { id: true }, _sum: { totalAmount: true } })
        ]);
        res.json({
            success: true,
            data: {
                payments: Object.fromEntries(payments.map(item => [item.method, (item._sum.amount || new client_1.Prisma.Decimal(0)).toString()])),
                expenses: (expenses._sum.amount || new client_1.Prisma.Decimal(0)).toString(),
                refunds: (refunds._sum.amount || new client_1.Prisma.Decimal(0)).toString(),
                debtsCreated: (debts._sum.amount || new client_1.Prisma.Decimal(0)).toString(),
                debtsCollected: (debtPayments._sum.amount || new client_1.Prisma.Decimal(0)).toString(),
                orders: Object.fromEntries(orders.map(item => [item.orderType, {
                        count: item._count.id, amount: (item._sum.totalAmount || new client_1.Prisma.Decimal(0)).toString()
                    }]))
            }
        });
    }
    catch (error) {
        console.error('Kassir hisobotini tuzishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Hisobotni olib bo‘lmadi' });
    }
});
router.get('/receipts', async (req, res) => {
    try {
        const receipts = await db_1.prisma.receipt.findMany({
            where: req.user.role === client_1.RoleType.CASHIER ? {
                order: { OR: [
                        { payments: { some: { cashierId: req.user.id } } },
                        { debt: { createdById: req.user.id } },
                        { debt: { payments: { some: { cashierId: req.user.id } } } }
                    ] }
            } : {},
            include: { order: { select: { id: true, orderNumber: true, orderType: true, totalAmount: true, createdAt: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        });
        res.json({ success: true, data: receipts });
    }
    catch (error) {
        console.error('Cheklar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Cheklar tarixini olib bo‘lmadi' });
    }
});
router.post('/receipts/:id/reprint', async (req, res) => {
    try {
        const receipt = await db_1.prisma.receipt.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                orderId: true,
                receiptNumber: true,
                order: { select: {
                        payments: { select: { cashierId: true } },
                        debt: { select: { createdById: true, payments: { select: { cashierId: true } } } },
                        printJobs: { where: { jobType: 'RECEIPT' }, orderBy: { createdAt: 'desc' }, take: 1 }
                    } }
            }
        });
        if (!receipt || (req.user.role === client_1.RoleType.CASHIER &&
            !receipt.order.payments.some(payment => payment.cashierId === req.user.id) &&
            receipt.order.debt?.createdById !== req.user.id &&
            !receipt.order.debt?.payments.some(payment => payment.cashierId === req.user.id))) {
            res.status(404).json({ success: false, message: 'Chek topilmadi' });
            return;
        }
        const lastJob = receipt.order.printJobs[0];
        if (!lastJob) {
            res.status(409).json({ success: false, message: 'Chek uchun chop etish ma’lumoti topilmadi' });
            return;
        }
        const job = await db_1.prisma.printJob.create({
            data: { orderId: receipt.orderId, payload: lastJob.payload, status: 'KUTILMOQDA', jobType: 'RECEIPT' }
        });
        await db_1.prisma.auditLog.create({
            data: { userId: req.user.id, action: 'RECEIPT_REPRINT_QUEUED', entity: 'Receipt', entityId: receipt.id }
        });
        res.status(201).json({ success: true, data: { jobId: job.id, payload: JSON.parse(job.payload), status: job.status } });
    }
    catch (error) {
        console.error('Chekni qayta chop etish navbatiga qo‘yishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chekni chop etishga tayyorlab bo‘lmadi' });
    }
});
router.get('/printers', (0, auth_1.requireRole)(['ADMIN']), async (_req, res) => {
    try {
        const printers = await db_1.prisma.printer.findMany({
            select: { id: true, name: true, department: true, isActive: true, ipAddress: true, port: true },
            orderBy: { department: 'asc' }
        });
        res.json({ success: true, data: printers.map(printer => ({ ...printer, status: printer.isActive ? 'CONFIGURED' : 'DISABLED' })) });
    }
    catch (error) {
        console.error('Printerlar holatini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Printerlar holatini olib bo‘lmadi' });
    }
});
router.get('/packaging', async (_req, res) => {
    try {
        const options = await db_1.prisma.packagingOption.findMany({
            where: { isActive: true, inventory: { isActive: true } },
            select: { id: true, name: true, sellingPrice: true, inventory: { select: { id: true, unit: true, quantity: true } } },
            orderBy: { name: 'asc' }
        });
        res.json({ success: true, data: options });
    }
    catch (error) {
        console.error('Qadoqlash ro‘yxatini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qadoqlash ro‘yxatini olib bo‘lmadi' });
    }
});
router.post('/packaging', (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const inventoryId = typeof req.body?.inventoryId === 'string' ? req.body.inventoryId : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    const sellingPrice = parseDecimal(req.body?.sellingPrice);
    if (!inventoryId || !name || !sellingPrice) {
        res.status(400).json({ success: false, message: 'Qadoqlash ma’lumotlari noto‘g‘ri' });
        return;
    }
    try {
        const inventory = await db_1.prisma.inventoryProduct.findFirst({ where: { id: inventoryId, isActive: true }, select: { id: true } });
        if (!inventory) {
            res.status(400).json({ success: false, message: 'Faol ombor mahsuloti topilmadi' });
            return;
        }
        const option = await db_1.prisma.packagingOption.upsert({
            where: { inventoryId },
            create: { inventoryId, name, sellingPrice },
            update: { name, sellingPrice, isActive: true }
        });
        res.status(201).json({ success: true, data: option });
    }
    catch (error) {
        console.error('Qadoqlash sozlamasini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qadoqlash sozlamasini saqlab bo‘lmadi' });
    }
});
router.post('/orders/:id/verify-pickup', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ success: false, message: '6 xonali tasdiqlash kodini kiriting' });
        return;
    }
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const verification = await tx.takeawayVerification.findUnique({
                where: { orderId: req.params.id },
                include: { order: { select: { id: true, orderNumber: true, orderType: true, status: true } } }
            });
            if (!verification || verification.order.orderType !== client_1.OrderType.TAKEAWAY ||
                verification.expiresAt < new Date() || verification.usedAt || verification.attempts >= 5) {
                return { failure: 'VERIFICATION_UNAVAILABLE' };
            }
            if (!matchesVerification(code, verification.codeHash)) {
                await tx.takeawayVerification.update({ where: { id: verification.id }, data: { attempts: { increment: 1 } } });
                await writeAudit(tx, req.user.id, 'TAKEAWAY_VERIFICATION_FAILED', 'Order', req.params.id, {
                    attempt: verification.attempts + 1
                });
                return { failure: 'VERIFICATION_INVALID' };
            }
            if (![client_1.OrderStatus.TOLANDI, client_1.OrderStatus.QISMAN_TOLANDI].includes(verification.order.status)) {
                return { failure: 'ORDER_NOT_PAID' };
            }
            const updatedInventoryIds = await (0, order_recipes_1.deductOrderRecipes)(tx, req.params.id, req.user.id);
            const updated = await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: client_1.OrderStatus.YAKUNLANDI,
                    completedAt: new Date(),
                    statusHistory: { create: { status: client_1.OrderStatus.YAKUNLANDI, userId: req.user.id, comment: 'Olib ketish kodi tasdiqlandi' } }
                }
            });
            await tx.takeawayVerification.update({
                where: { id: verification.id },
                data: { usedAt: new Date(), verifiedById: req.user.id }
            });
            await (0, order_packaging_1.deductPackaging)(tx, updated.id, req.user.id);
            await writeAudit(tx, req.user.id, 'TAKEAWAY_PICKED_UP', 'Order', updated.id);
            return { order: updated, updatedInventoryIds };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        if ('failure' in result) {
            const responses = {
                VERIFICATION_INVALID: { status: 400, message: 'Tasdiqlash kodi noto‘g‘ri' },
                VERIFICATION_UNAVAILABLE: { status: 409, message: 'Kod bekor bo‘lgan, muddati tugagan yoki urinishlar soni oshgan' },
                ORDER_NOT_PAID: { status: 409, message: 'Buyurtma to‘lov holatida emas' }
            };
            const response = responses[result.failure];
            res.status(response.status).json({ success: false, message: response.message });
            return;
        }
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: result.order.id, status: result.order.status });
        if (result.updatedInventoryIds.length)
            (0, socket_1.emitSocketEvent)('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.json({ success: true, message: 'Tasdiqlash kodi qabul qilindi, buyurtma topshirildi' });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsuloti qoldig‘i yetarli emas' });
            return;
        }
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldig‘i yetarli emas` });
            return;
        }
        console.error('Olib ketish kodini tekshirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kodni tekshirib bo‘lmadi' });
    }
});
router.post('/orders/:id/verification/renew', (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const code = String((0, crypto_1.randomInt)(100000, 1000000));
    try {
        const renewed = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const verification = await tx.takeawayVerification.findUnique({
                where: { orderId: req.params.id },
                include: { order: { select: { id: true, orderNumber: true, orderType: true, customer: { select: { telegramId: true } } } } }
            });
            if (!verification || verification.order.orderType !== client_1.OrderType.TAKEAWAY || verification.usedAt) {
                throw new Error('VERIFICATION_CANNOT_RENEW');
            }
            const updated = await tx.takeawayVerification.update({
                where: { id: verification.id },
                data: { codeHash: makeVerification(code), expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), attempts: 0 }
            });
            await writeAudit(tx, req.user.id, 'TAKEAWAY_VERIFICATION_RENEWED', 'Order', verification.order.id, {
                orderNumber: verification.order.orderNumber
            });
            return { updated, telegramId: verification.order.customer?.telegramId };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        let telegramSent = false;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (renewed.telegramId && token) {
            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: renewed.telegramId,
                    text: `Olib ketish uchun yangi tasdiqlash kodingiz: ${code}`
                })
            });
            telegramSent = response.ok;
            if (!response.ok)
                console.error('Yangi Telegram kodi yuborilmadi:', await response.text());
        }
        res.json({ success: true, data: { expiresAt: renewed.updated.expiresAt, code, telegramSent } });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'VERIFICATION_CANNOT_RENEW') {
            res.status(409).json({ success: false, message: 'Bu buyurtma uchun kodni yangilab bo‘lmaydi' });
            return;
        }
        console.error('Olib ketish kodini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tasdiqlash kodini yangilab bo‘lmadi' });
    }
});
router.post('/admin-access', async (req, res) => {
    if (req.user.role !== client_1.RoleType.CASHIER) {
        res.status(409).json({ success: false, message: 'Siz allaqachon Admin rejimidasiz' });
        return;
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) {
        res.status(400).json({ success: false, message: 'Admin login va parolini kiriting' });
        return;
    }
    try {
        const admin = await db_1.prisma.user.findUnique({
            where: { username },
            select: { id: true, role: true, fullName: true, passwordHash: true, isActive: true, updatedAt: true }
        });
        if (!admin || !admin.isActive || admin.role !== client_1.RoleType.ADMIN || !await (0, password_1.verifyPassword)(password, admin.passwordHash)) {
            res.status(401).json({ success: false, message: 'Admin login yoki paroli noto‘g‘ri' });
            return;
        }
        const access = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.adminTerminalAccess.create({
                data: { cashierId: req.user.id, adminId: admin.id }
            });
            await writeAudit(tx, admin.id, 'ADMIN_TERMINAL_ACCESS_STARTED', 'AdminTerminalAccess', created.id, {
                cashierId: req.user.id, cashierName: req.user.fullName
            });
            return created;
        });
        (0, auth_1.setTerminalAdminCookie)(res, admin, access.id);
        res.json({ success: true, data: { admin: admin.fullName, accessId: access.id, adminUrl: '/admin/' } });
    }
    catch (error) {
        console.error('Kassir terminalida Admin ruxsatini berishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Admin sessiyasini ochib bo‘lmadi' });
    }
});
router.post('/admin-access/close', (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    const accessId = req.user.terminalAccessId;
    if (!accessId) {
        res.status(409).json({ success: false, message: 'Kassir terminali Admin sessiyasi aniqlanmadi' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            const access = await tx.adminTerminalAccess.update({
                where: { id: accessId },
                data: { endedAt: new Date() }
            });
            await writeAudit(tx, access.adminId, 'ADMIN_TERMINAL_ACCESS_ENDED', 'AdminTerminalAccess', access.id, {
                cashierId: access.cashierId
            });
        });
        (0, auth_1.clearTerminalAdminCookie)(res);
        res.json({ success: true, message: 'Kassir rejimiga qaytdingiz' });
    }
    catch (error) {
        console.error('Admin terminal sessiyasini yopishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Admin sessiyasini yopib bo‘lmadi' });
    }
});
exports.default = router;
