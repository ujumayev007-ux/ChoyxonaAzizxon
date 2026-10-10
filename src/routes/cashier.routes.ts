import { createHash, randomBytes, randomInt } from 'crypto';
import { OrderSource, OrderStatus, OrderType, PaymentMethod, Prisma, RoleType } from '@prisma/client';
import { Router } from 'express';
import { authenticateToken, clearTerminalAdminCookie, requireCashierAccess, requireRole, setTerminalAdminCookie } from '../middleware/auth';
import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';
import { verifyPassword } from '../utils/password';
import { deductPackaging } from '../utils/order-packaging';
import { deductOrderRecipes } from '../utils/order-recipes';
import { formatTelegramMessage, sendToActiveSubscribers } from '../utils/telegram';
const router = Router();
router.use(authenticateToken, requireCashierAccess);

const activeStatuses: OrderStatus[] = [
    OrderStatus.YANGI,
    OrderStatus.KUTILMOQDA,
    OrderStatus.ADMIN_TASDIGINI_KUTMOQDA,
    OrderStatus.TASDIQLANDI,
    OrderStatus.OSHXONAGA_YUBORILDI,
    OrderStatus.TAYYORLANMOQDA,
    OrderStatus.TAYYOR,
    OrderStatus.STOLGA_YETKAZILDI,
    OrderStatus.TOLOV_KUTILMOQDA,
    OrderStatus.QISMAN_TOLANDI
];
const moneyPattern = /^\d{1,12}(?:\.\d{1,2})?$/;
const quantityPattern = /^\d{1,10}(?:\.\d{1,6})?$/;
const methods: Record<string, PaymentMethod> = {
    NAQD: PaymentMethod.NAQD,
    CASH: PaymentMethod.NAQD,
    cash: PaymentMethod.NAQD,
    Naqd: PaymentMethod.NAQD,
    PLASTIK: PaymentMethod.PLASTIK,
    CARD: PaymentMethod.PLASTIK,
    card: PaymentMethod.PLASTIK,
    'Plastik karta': PaymentMethod.PLASTIK,
    ELEKTRON: PaymentMethod.ELEKTRON,
    ELECTRONIC: PaymentMethod.ELEKTRON,
    electronic: PaymentMethod.ELEKTRON,
    'Elektron toвЂlov': PaymentMethod.ELEKTRON
};

const parseDecimal = (value: unknown, pattern = moneyPattern): Prisma.Decimal | null => {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    if (!pattern.test(text)) return null;
    const result = new Prisma.Decimal(text);
    return result.isFinite() ? result : null;
};

const parseMethod = (value: unknown): PaymentMethod | null =>
    typeof value === 'string' ? methods[value] || null : null;

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

const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function getIdempotencyKey(value: unknown): string | null {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value) ? value : null;
}

async function readIdempotentResult(key: string, userId: string, operation: string, hash: string) {
    const record = await prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!record) return null;
    if (record.userId !== userId || record.operation !== operation || record.requestHash !== hash) {
        throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    return JSON.parse(record.responseJson) as unknown;
}

async function saveIdempotentResult(
    tx: Prisma.TransactionClient,
    key: string,
    userId: string,
    operation: string,
    hash: string,
    resourceId: string | null,
    result: unknown
) {
    await tx.idempotencyRecord.create({
        data: { key, userId, operation, requestHash: hash, resourceId, responseJson: JSON.stringify(result) }
    });
}

async function writeAudit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    entity: string,
    entityId: string | null,
    value?: unknown
) {
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

async function openSession(tx: Prisma.TransactionClient, cashierId: string) {
    return tx.cashSession.findFirst({
        where: { cashierId, activeCashierId: cashierId },
        select: { id: true, startingBalance: true }
    });
}

function createOrderNumber() {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
        .format(new Date()).replace(/-/g, '');
    return `${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function makeVerification(code: string) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${createHash('sha256').update(`${salt}:${code}`).digest('hex')}`;
}

function matchesVerification(code: string, saved: string) {
    const [salt, hash, ...extra] = saved.split(':');
    return Boolean(salt && hash && !extra.length &&
        createHash('sha256').update(`${salt}:${code}`).digest('hex') === hash);
}

async function addCashMovement(
    tx: Prisma.TransactionClient,
    userId: string,
    type: string,
    amount: Prisma.Decimal,
    referenceId?: string,
    note?: string
) {
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
            ...(req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {})
        };
        const expenseWhere = {
            createdAt: { gte: start },
            ...(req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {})
        };
        const refundWhere = {
            createdAt: { gte: start },
            ...(req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {})
        };
        const [payments, expenseAggregate, refundAggregate, debts, debtSales, statusCounts, verificationAlerts, activeOrders, session, movements] =
            await Promise.all([
                prisma.payment.groupBy({ by: ['method'], where: paymentWhere, _sum: { amount: true } }),
                prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
                prisma.refund.aggregate({ where: refundWhere, _sum: { amount: true } }),
                prisma.customerDebt.aggregate({
                    where: { remaining: { gt: 0 } },
                    _sum: { remaining: true },
                    _count: { customerId: true }
                }),
                prisma.customerDebt.aggregate({
                    where: {
                        createdAt: { gte: start },
                        ...(req.user!.role === RoleType.CASHIER ? { createdById: req.user!.id } : {})
                    },
                    _sum: { amount: true }
                }),
                prisma.order.groupBy({
                    by: ['status'],
                    where: { status: { in: activeStatuses } },
                    _count: { id: true }
                }),
                prisma.takeawayVerification.count({
                    where: { attempts: { gt: 0 }, usedAt: null, expiresAt: { gt: new Date() } }
                }),
                prisma.order.findMany({
                    where: {
                        OR: [
                            { status: { in: activeStatuses } },
                            {
                                orderType: OrderType.TAKEAWAY,
                                status: OrderStatus.TOLANDI,
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
                openSession(prisma, req.user!.id),
                prisma.cashMovement.findMany({
                    where: { createdAt: { gte: start }, userId: req.user!.id },
                    select: { type: true, amount: true, createdAt: true }
                })
            ]);
        const sessionMovements = session ? await prisma.cashMovement.findMany({
            where: { sessionId: session.id },
            select: { amount: true }
        }) : movements;
        const totals = {
            NAQD: new Prisma.Decimal(0),
            PLASTIK: new Prisma.Decimal(0),
            ELEKTRON: new Prisma.Decimal(0)
        };
        payments.forEach(item => {
            if (item.method !== PaymentMethod.QARZ) totals[item.method] = new Prisma.Decimal(item._sum.amount || 0);
        });
        const cashToday = sessionMovements.reduce((total, movement) => total.plus(movement.amount), new Prisma.Decimal(0));
        const statusMap = Object.fromEntries(statusCounts.map(item => [item.status, item._count.id]));
        const refundAmount = refundAggregate._sum.amount || new Prisma.Decimal(0);
        const sales = totals.NAQD.plus(totals.PLASTIK).plus(totals.ELEKTRON)
            .plus(debtSales._sum.amount || new Prisma.Decimal(0));
        const expenseAmount = expenseAggregate._sum.amount || new Prisma.Decimal(0);
        res.json({
            success: true,
            data: {
                user: req.user,
                sales: sales.toString(),
                cash: totals.NAQD.toString(),
                card: totals.PLASTIK.toString(),
                electronic: totals.ELEKTRON.toString(),
                debt: (debts._sum.remaining || new Prisma.Decimal(0)).toString(),
                refunds: refundAmount.toString(),
                expenses: expenseAmount.toString(),
                ...(req.user!.role === RoleType.ADMIN
                    ? { netRevenue: sales.minus(refundAmount).minus(expenseAmount).toString() }
                    : {}),
                openOrders: activeOrders.filter(order => activeStatuses.includes(order.status)).length,
                takeawayOrders: activeOrders.filter(order => order.orderType === OrderType.TAKEAWAY).length,
                debtors: debts._count.customerId,
                registerCash: session ? cashToday.toString() : null,
                verificationAlerts,
                statusCounts: statusMap,
                activeOrders
            }
        });
    } catch (error) {
        console.error('Kassir bosh sahifasini yuklashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa maвЂ™lumotlarini yuklab boвЂlmadi' });
    }
});

router.get('/orders', async (req, res) => {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const orderType = req.query.type === 'TAKEAWAY' ? OrderType.TAKEAWAY :
        req.query.type === 'DINE_IN' ? OrderType.DINE_IN : undefined;
    const status = typeof req.query.status === 'string' &&
        Object.values(OrderStatus).includes(req.query.status as OrderStatus)
        ? req.query.status as OrderStatus : undefined;
    try {
        const orders = await prisma.order.findMany({
            where: {
                AND: [
                    ...(status ? [{ status }] : []),
                    ...(orderType ? [{ orderType }] : []),
                    req.query.closed === 'true'
                        ? { status: { in: [OrderStatus.QISMAN_TOLANDI, OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI, OrderStatus.QAYTARILDI] } }
                        : {
                            OR: [
                                { status: { in: activeStatuses } },
                                {
                                    orderType: OrderType.TAKEAWAY,
                                    status: OrderStatus.TOLANDI,
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
    } catch (error) {
        console.error('Kassir buyurtmalarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmalarni yuklab boвЂlmadi' });
    }
});

router.post('/orders', async (req, res) => {
    const type = req.body?.orderType === 'TAKEAWAY' ? OrderType.TAKEAWAY : OrderType.DINE_IN;
    const itemsInput: unknown = req.body?.items;
    const packagingInput: unknown = req.body?.packaging;
    if (!Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 100 ||
        itemsInput.some(item => !item || typeof item.menuItemId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0))) {
        res.status(400).json({ success: false, message: 'Buyurtma taomlari yoki miqdori notoвЂgвЂri' });
        return;
    }
    if (type === OrderType.DINE_IN && typeof req.body?.tableId !== 'string') {
        res.status(400).json({ success: false, message: 'Zal buyurtmasi uchun stol tanlang' });
        return;
    }
    if (type === OrderType.TAKEAWAY && !req.body?.customerId &&
        (!String(req.body?.customerName || '').trim() || !String(req.body?.customerPhone || '').trim())) {
        res.status(400).json({ success: false, message: 'Olib ketish buyurtmasiga mijoz ismi va telefoni kerak' });
        return;
    }
    if (packagingInput !== undefined && (!Array.isArray(packagingInput) ||
        packagingInput.some(item => !item || typeof item.optionId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0)))) {
        res.status(400).json({ success: false, message: 'Qadoqlash maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    try {
        const tableId = type === OrderType.DINE_IN ? req.body.tableId as string : null;
        if (tableId) {
            const table = await prisma.table.findFirst({ where: { id: tableId, room: {  } } });
            if (!table) {
                res.status(400).json({ success: false, message: 'Faol stol topilmadi' });
                return;
            }
        }
        const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : null;
        if (customerId && !await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })) {
            res.status(400).json({ success: false, message: 'Mijoz topilmadi yoki faol emas' });
            return;
        }
        const menuIds = [...new Set((itemsInput as Array<{ menuItemId: string }>).map(item => item.menuItemId))];
        const menu = await prisma.menuItem.findMany({
            where: { id: { in: menuIds }, category: {  } },
            select: { id: true, name: true, sellingPrice: true }
        });
        if (menu.length !== menuIds.length) {
            res.status(400).json({ success: false, message: 'Menyu taomi topilmadi yoki faol emas' });
            return;
        }
        const menuById = new Map(menu.map(item => [item.id, item]));
        const orderItems = (itemsInput as Array<{ menuItemId: string; quantity: string | number; notes?: string }>).map(item => {
            const menuItem = menuById.get(item.menuItemId)!;
            const quantity = parseDecimal(item.quantity, quantityPattern)!;
            const unitPrice = new Prisma.Decimal(menuItem.sellingPrice);
            return {
                menuItemId: menuItem.id,
                quantity,
                unitPrice,
                totalPrice: unitPrice.mul(quantity),
                ...(typeof item.notes === 'string' && item.notes.trim() ? { notes: item.notes.trim().slice(0, 500) } : {})
            };
        });
        const packageRows = (packagingInput || []) as Array<{ optionId: string; quantity: string | number }>;
        const packageOptions = packageRows.length ? await prisma.packagingOption.findMany({
            where: { id: { in: packageRows.map(item => item.optionId) } },
            include: { inventory: { select: { id: true, name: true, unit: true, quantity: true } } }
        }) : [];
        if (packageOptions.length !== new Set(packageRows.map(item => item.optionId)).size) {
            res.status(400).json({ success: false, message: 'Qadoqlash mahsuloti topilmadi yoki faol emas' });
            return;
        }
        const packageById = new Map(packageOptions.map(option => [option.id, option]));
        const packagingItems = packageRows.map(item => {
            const option = packageById.get(item.optionId)!;
            const quantity = parseDecimal(item.quantity, quantityPattern)!;
            if (new Prisma.Decimal(option.inventory.quantity).lessThan(quantity)) throw new Error('PACKAGING_STOCK_SHORT');
            const unitPrice = new Prisma.Decimal(option.sellingPrice);
            return { inventoryId: option.inventoryId, quantity, unitPrice, totalPrice: unitPrice.mul(quantity) };
        });
        const subtotal = orderItems.reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0))
            .plus(packagingItems.reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0)));
        const code = type === OrderType.TAKEAWAY ? String(randomInt(100000, 1000000)) : null;
        const order = await prisma.$transaction(async tx => {
            const created = await tx.order.create({
                data: {
                    orderNumber: createOrderNumber(),
                    orderType: type,
                    source: OrderSource.CASHIER,
                    status: OrderStatus.TASDIQLANDI,
                    ...(tableId ? { tableId } : {}),
                    ...(customerId ? { customerId } : {}),
                    ...(typeof req.body?.customerName === 'string' && req.body.customerName.trim()
                        ? { customerName: req.body.customerName.trim().slice(0, 120) } : {}),
                    ...(typeof req.body?.customerPhone === 'string' && req.body.customerPhone.trim()
                        ? { customerPhone: req.body.customerPhone.trim().slice(0, 40) } : {}),
                    createdById: req.user!.id,
                    waiterId: null,
                    subtotal,
                    totalAmount: subtotal,
                    approvedAt: new Date(),
                    sentToKitchenAt: new Date(),
                    items: { create: orderItems },
                    ...(packagingItems.length ? { packagingItems: { create: packagingItems } } : {}),
                    statusHistory: { create: {
                        status: OrderStatus.TASDIQLANDI,
                        userId: req.user!.id,
                        comment: `Cashier ${type === OrderType.TAKEAWAY ? 'takeaway' : 'zal'} order created`
                    } },
                    ...(code ? { takeawayVerification: { create: {
                        codeHash: makeVerification(code),
                        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000)
                    } } } : {})
                },
                select: { id: true, orderNumber: true, totalAmount: true, orderType: true, source: true, status: true }
            });
            await writeAudit(tx, req.user!.id, 'ORDER_CREATED', 'Order', created.id, { source: 'CASHIER', orderType: type });
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('orderUpdate', { orderId: order.id, status: order.status, source: order.source, orderType: order.orderType });
        emitSocketEvent('kitchen_new_order', { orderId: order.id });
        let telegramSent = false;
        if (code && customerId) {
            const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { telegramId: true } });
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
                if (!telegramSent) console.error('Telegram verification code delivery failed:', await telegramResponse.text());
            }
        }
        res.status(201).json({
            success: true,
            data: { ...order, ...(code ? { verificationCode: code, telegramSent } : {}) }
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsulotining ombordagi qoldigвЂi yetarli emas' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'MaвЂ™lumotlar bir vaqtda oвЂzgardi, qayta urinib koвЂring' });
            return;
        }
        console.error('Kassir buyurtmasini yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtma yaratilmadi' });
    }
});

router.post('/orders/:id/lock', async (req, res) => {
    try {
        const current = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, processingById: true, processingAt: true, status: true, processingBy: { select: { fullName: true } } }
        });
        if (!current) {
            res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
            return;
        }
        if (([OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI, OrderStatus.BEKOR_QILINDI, OrderStatus.QAYTARILDI] as OrderStatus[]).includes(current.status)) {
            res.status(409).json({ success: false, message: 'Yakunlangan buyurtmani kassaga bandlab boвЂlmaydi' });
            return;
        }
        const expired = !current.processingAt || Date.now() - current.processingAt.getTime() > 10 * 60 * 1000;
        if (current.processingById && current.processingById !== req.user!.id && !expired) {
            res.status(409).json({ success: false, message: `${current.processingBy?.fullName || 'Xodim'} buyurtmani qayta ishlamoqda` });
            return;
        }
        const result = await prisma.order.updateMany({
            where: {
                id: req.params.id,
                OR: [{ processingById: null }, { processingById: req.user!.id }, ...(expired ? [{ processingAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } }] : [])]
            },
            data: { processingById: req.user!.id, processingAt: new Date() }
        });
        if (!result.count) {
            res.status(409).json({ success: false, message: 'Buyurtma hozir boshqa xodimda' });
            return;
        }
        emitSocketEvent('order_processing_changed', { orderId: req.params.id, processingBy: req.user });
        res.json({ success: true });
    } catch (error) {
        console.error('Buyurtmani kassirga biriktirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmani band qilib boвЂlmadi' });
    }
});

router.post('/orders/:id/unlock', async (req, res) => {
    try {
        await prisma.order.updateMany({
            where: { id: req.params.id, processingById: req.user!.id },
            data: { processingById: null, processingAt: null }
        });
        emitSocketEvent('order_processing_changed', { orderId: req.params.id, processingBy: null });
        res.json({ success: true });
    } catch (error) {
        console.error('Buyurtma bandligini yechishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtmani boвЂshatib boвЂlmadi' });
    }
});

router.post('/payments', async (req, res) => {
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
    const idempotencyKey = getIdempotencyKey(req.body?.idempotencyKey);
    const submitted = Array.isArray(req.body?.payments)
        ? req.body.payments as Array<{ method?: unknown; amount?: unknown; customerGiven?: unknown; transactionRef?: unknown }>
        : [{ method: req.body?.method, amount: req.body?.amountPaid, customerGiven: req.body?.customerGiven, transactionRef: req.body?.transactionRef }];
    const debtAmount = parseDecimal(req.body?.debtAmount ?? '0');
    const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : null;
    if (!orderId || !idempotencyKey || !debtAmount || submitted.length > 3 ||
        (submitted.length === 0 && debtAmount.isZero())) {
        res.status(400).json({ success: false, message: 'ToвЂlov maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    const rows = submitted.map(row => ({
        method: parseMethod(row.method),
        amount: parseDecimal(row.amount),
        customerGiven: row.customerGiven === undefined ? null : parseDecimal(row.customerGiven),
        transactionRef: typeof row.transactionRef === 'string' ? row.transactionRef.trim().slice(0, 120) : null
    }));
    if (rows.some(row => !row.method || row.method === PaymentMethod.QARZ || !row.amount?.greaterThan(0) ||
        (row.customerGiven && !row.customerGiven.greaterThan(0)))) {
        res.status(400).json({ success: false, message: 'ToвЂlov usuli yoki summasi notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ orderId, rows: rows.map(row => ({
        method: row.method, amount: row.amount!.toString(), customerGiven: row.customerGiven?.toString() || null,
        transactionRef: row.transactionRef
    })), debtAmount: debtAmount.toString(), customerId });
    try {
        const previous = await readIdempotentResult(idempotencyKey, req.user!.id, 'PAYMENT', hash);
        if (previous) {
            res.json({ success: true, duplicate: true, data: previous });
            return;
        }
        const result = await prisma.$transaction(async tx => {
            const updatedInventoryIds = new Set<string>();
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
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
            if (!order) throw new Error('ORDER_NOT_FOUND');
            if (([OrderStatus.BEKOR_QILINDI, OrderStatus.QAYTARILDI, OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI] as OrderStatus[]).includes(order.status)) {
                throw new Error('ORDER_NOT_PAYABLE');
            }
            if (order.processingById && order.processingById !== req.user!.id) throw new Error('ORDER_LOCKED');
            const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
            const existingDebt = order.debt?.amount || new Prisma.Decimal(0);
            const remaining = new Prisma.Decimal(order.totalAmount).minus(paid).minus(existingDebt);
            const cashTotal = rows.filter(row => row.method === PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.amount!), new Prisma.Decimal(0));
            const nonCashTotal = rows.filter(row => row.method !== PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.amount!), new Prisma.Decimal(0));
            const paidNow = cashTotal.plus(nonCashTotal);
            if (paidNow.plus(debtAmount).greaterThan(remaining) || paidNow.plus(debtAmount).lessThanOrEqualTo(0)) {
                throw new Error('PAYMENT_AMOUNT_INVALID');
            }
            if (debtAmount.greaterThan(0) && !customerId && !order.customerId) throw new Error('CUSTOMER_REQUIRED');
            const debtCustomerId = customerId || order.customerId;
            if (debtAmount.greaterThan(0) && debtCustomerId &&
                !await tx.customer.findFirst({ where: { id: debtCustomerId }, select: { id: true } })) {
                throw new Error('CUSTOMER_REQUIRED');
            }
            const change = rows.filter(row => row.method === PaymentMethod.NAQD)
                .reduce((sum, row) => sum.plus(row.customerGiven || row.amount!), new Prisma.Decimal(0))
                .minus(cashTotal);
            if (change.isNegative()) throw new Error('CASH_INSUFFICIENT');
            const createdPayments = [];
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                const cashChange = row.method === PaymentMethod.NAQD && index === rows.findIndex(item => item.method === PaymentMethod.NAQD)
                    ? change : new Prisma.Decimal(0);
                createdPayments.push(await tx.payment.create({
                    data: {
                        orderId,
                        cashierId: req.user!.id,
                        method: row.method!,
                        amount: row.amount!,
                        ...(row.method === PaymentMethod.NAQD ? { customerGiven: row.customerGiven || row.amount!.plus(cashChange), changeAmount: cashChange } : {}),
                        ...(row.transactionRef ? { transactionRef: row.transactionRef } : {}),
                        idempotencyKey: `${idempotencyKey}_${index}`
                    },
                    select: { id: true, method: true, amount: true, changeAmount: true }
                }));
                if (row.method === PaymentMethod.NAQD) {
                    await addCashMovement(tx, req.user!.id, 'SALE', row.amount!, orderId);
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
                        data: { customerId: debtCustomerId, orderId, amount: debtAmount, remaining: debtAmount, createdById: req.user!.id }
                    });
            }
            const totalPaid = paid.plus(paidNow);
            const fullySettled = totalPaid.plus(existingDebt).plus(debtAmount).greaterThanOrEqualTo(order.totalAmount);
            const status = fullySettled && existingDebt.isZero() && debtAmount.isZero()
                ? OrderStatus.TOLANDI : OrderStatus.QISMAN_TOLANDI;
            const updated = await tx.order.update({
                where: { id: orderId },
                data: {
                    status,
                    ...(status === OrderStatus.TOLANDI ? { paidAt: new Date() } : {}),
                    processingById: null,
                    processingAt: null,
                    ...(debtCustomerId && !order.customerId ? { customerId: debtCustomerId } : {}),
                    statusHistory: { create: { status, userId: req.user!.id, comment: `Kassir toвЂlovi: ${paidNow.toString()}` } }
                },
                select: { id: true, orderNumber: true, status: true, totalAmount: true, orderType: true }
            });
            if (status === OrderStatus.TOLANDI && order.orderType === OrderType.DINE_IN) {
                await deductPackaging(tx, orderId, req.user!.id);
            }
            if (status === OrderStatus.TOLANDI) {
                for (const id of await deductOrderRecipes(tx, orderId, req.user!.id)) updatedInventoryIds.add(id);
            }
            const receiptNumber = `${order.orderNumber}-${Date.now()}-${randomBytes(2).toString('hex').toUpperCase()}`;
            const receipt = await tx.receipt.create({
                data: { orderId, receiptNumber, qrHash: createHash('sha256').update(randomBytes(32)).digest('hex') }
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
                cashier: req.user!.fullName,
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
            await writeAudit(tx, req.user!.id, 'PAYMENT_RECEIVED', 'Order', orderId, {
                paymentIds: createdPayments.map(payment => payment.id), amount: paidNow.toString(), debt: debtAmount.toString()
            });
            if (debt) await writeAudit(tx, req.user!.id, 'DEBT_CREATED', 'CustomerDebt', debt.id, { amount: debtAmount.toString() });
            const response = { order: updated, payments: createdPayments, debtAmount: debtAmount.toString(), change: change.toString(), receipt };
            await saveIdempotentResult(tx, idempotencyKey, req.user!.id, 'PAYMENT', hash, orderId, response);
            return { response, updatedInventoryIds: [...updatedInventoryIds] };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('paymentReceived', { orderId, status: result.response.order.status });
        emitSocketEvent('orderUpdate', { orderId, status: result.response.order.status });
        if (result.updatedInventoryIds.length) emitSocketEvent('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.json({ success: true, data: result.response });
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldigвЂi yetarli emas` });
            return;
        }
        const knownErrors: Record<string, { status: number; message: string }> = {
            ORDER_NOT_FOUND: { status: 404, message: 'Buyurtma topilmadi' },
            ORDER_NOT_PAYABLE: { status: 409, message: 'Buyurtmani toвЂlab boвЂlmaydi' },
            ORDER_LOCKED: { status: 409, message: 'Buyurtma boshqa xodim tomonidan qayta ishlanmoqda' },
            PAYMENT_AMOUNT_INVALID: { status: 400, message: 'ToвЂlov va qarz summasi qoldiq summaga mos emas' },
            CUSTOMER_REQUIRED: { status: 400, message: 'Qarz uchun mijozni tanlang' },
            CASH_INSUFFICIENT: { status: 400, message: 'Mijoz bergan naqd pul yetarli emas' },
            IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' }
        };
        if (error instanceof Error && knownErrors[error.message]) {
            const result = knownErrors[error.message];
            res.status(result.status).json({ success: false, message: result.message });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
            res.status(409).json({ success: false, message: 'ToвЂlov allaqachon yuborilgan yoki maвЂ™lumotlar yangilandi. Sahifani yangilang.' });
            return;
        }
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsuloti qoldigвЂi yetarli emas' });
            return;
        }
        console.error('Kassir toвЂlovini yozishda xatolik:', error);
        res.status(500).json({ success: false, message: 'ToвЂlovni amalga oshirib boвЂlmadi' });
    }
});

router.get('/payments', async (req, res) => {
    try {
        const payments = await prisma.payment.findMany({
            where: req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {},
            include: {
                cashier: { select: { fullName: true } },
                order: { select: { id: true, orderNumber: true, orderType: true, customerName: true, table: { select: { number: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 250
        });
        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('ToвЂlovlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'ToвЂlovlar tarixini olib boвЂlmadi' });
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
        const customers = await prisma.customer.findMany({
            where: {
                
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
                orders: { select: { totalAmount: true, status: true }, where: { status: { in: [OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI, OrderStatus.QAYTARILDI] } } },
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
                purchases: customer.orders.reduce((sum, order) => sum.plus(order.totalAmount), new Prisma.Decimal(0)).toString(),
                debt: customer.debts.reduce((sum, debt) => sum.plus(debt.remaining), new Prisma.Decimal(0)).toString()
            }))
        });
    } catch (error) {
        console.error('Mijozlarni qidirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijozlarni qidirib boвЂlmadi' });
    }
});

router.post('/customers', async (req, res) => {
    const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim().slice(0, 80) : '';
    const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim().slice(0, 80) : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 40) : '';
    const phoneDigits = phone.replace(/\D/g, '');
    if (!firstName || !phoneDigits || phoneDigits.length < 7) {
        res.status(400).json({ success: false, message: 'Mijoz ismi va toвЂgвЂri telefon raqami kerak' });
        return;
    }
    try {
        const customer = await prisma.customer.create({
            data: { firstName, lastName, phone, phoneDigits },
            select: { id: true, customerNumber: true, firstName: true, lastName: true, phone: true }
        });
        res.status(201).json({ success: true, data: customer });
    } catch (error) {
        console.error('Mijoz yaratishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijozni yaratib boвЂlmadi' });
    }
});

router.get('/customers/:id', async (req, res) => {
    try {
        const customer = await prisma.customer.findUnique({
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
    } catch (error) {
        console.error('Mijoz kartasini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijoz maвЂ™lumotlarini olib boвЂlmadi' });
    }
});

router.patch('/customers/:id', requireRole(['ADMIN']), async (req, res) => {
    const status = req.body?.status;
    if (status !== undefined && !['YANGI', 'DOIMIY', 'VIP', 'ODDIY'].includes(status)) {
        res.status(400).json({ success: false, message: 'Mijoz holati notoвЂgвЂri' });
        return;
    }
    const data: Prisma.CustomerUpdateInput = {};
    if (typeof req.body?.firstName === 'string' && req.body.firstName.trim()) data.firstName = req.body.firstName.trim().slice(0, 80);
    if (typeof req.body?.lastName === 'string') data.lastName = req.body.lastName.trim().slice(0, 80);
    if (typeof req.body?.phone === 'string') {
        data.phone = req.body.phone.trim().slice(0, 40);
        data.phoneDigits = req.body.phone.replace(/\D/g, '');
    }
    if (typeof req.body?.notes === 'string') data.notes = req.body.notes.trim().slice(0, 1000);
    if (typeof status === 'string') data.status = status;
    if (!Object.keys(data).length) {
        res.status(400).json({ success: false, message: 'Yangilash uchun maвЂ™lumot kiriting' });
        return;
    }
    try {
        const customer = await prisma.$transaction(async tx => {
            const updated = await tx.customer.update({ where: { id: req.params.id }, data });
            await writeAudit(tx, req.user!.id, 'CUSTOMER_UPDATED', 'Customer', updated.id, { fields: Object.keys(data) });
            return updated;
        });
        res.json({ success: true, data: { id: customer.id, customerNumber: customer.customerNumber, firstName: customer.firstName, lastName: customer.lastName, status: customer.status } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            res.status(404).json({ success: false, message: 'Mijoz topilmadi' });
            return;
        }
        console.error('Mijoz maвЂ™lumotlarini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Mijoz maвЂ™lumotlarini yangilab boвЂlmadi' });
    }
});

router.get('/debts', async (req, res) => {
    try {
        const debts = await prisma.customerDebt.findMany({
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
    } catch (error) {
        console.error('Qarzlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qarzlar tarixini olib boвЂlmadi' });
    }
});

router.post('/debts/:id/payments', async (req, res) => {
    const amount = parseDecimal(req.body?.amount);
    const method = parseMethod(req.body?.method);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!amount?.greaterThan(0) || !method || method === PaymentMethod.QARZ || !key) {
        res.status(400).json({ success: false, message: 'Qarz toвЂlovi maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ debtId: req.params.id, amount: amount.toString(), method });
    try {
        const duplicate = await readIdempotentResult(key, req.user!.id, 'DEBT_PAYMENT', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const result = await prisma.$transaction(async tx => {
            const updatedInventoryIds = new Set<string>();
            await tx.$queryRaw`SELECT "id" FROM "CustomerDebt" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const debt = await tx.customerDebt.findUnique({ where: { id: req.params.id } });
            if (!debt || debt.remaining.lessThan(amount)) throw new Error('DEBT_PAYMENT_INVALID');
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
            if (!order) throw new Error('DEBT_PAYMENT_INVALID');
            let settledOrderId: string | null = null;
            const payment = await tx.debtPayment.create({
                data: {
                    customerId: debt.customerId,
                    debtId: debt.id,
                    cashierId: req.user!.id,
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
                if (order.status === OrderStatus.QISMAN_TOLANDI || order.status === OrderStatus.TOLOV_KUTILMOQDA) {
                    const paid = order.payments.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
                    const refunded = order.refunds.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
                    if (paid.minus(refunded).plus(debt.amount).equals(order.totalAmount)) {
                        await tx.order.update({
                            where: { id: order.id },
                            data: {
                                status: OrderStatus.TOLANDI,
                                paidAt: new Date(),
                                statusHistory: { create: { status: OrderStatus.TOLANDI, userId: req.user!.id, comment: 'Qarz toвЂliq toвЂlandi' } }
                            }
                        });
                        settledOrderId = order.id;
                        if (order.orderType === OrderType.DINE_IN) await deductPackaging(tx, order.id, req.user!.id);
                        for (const id of await deductOrderRecipes(tx, order.id, req.user!.id)) updatedInventoryIds.add(id);
                    }
                }
            }
            const receiptNumber = `${order.orderNumber}-D${Date.now()}-${randomBytes(2).toString('hex').toUpperCase()}`;
            const receipt = await tx.receipt.create({
                data: { orderId: order.id, receiptNumber, qrHash: createHash('sha256').update(randomBytes(32)).digest('hex') }
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
                cashier: req.user!.fullName,
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
            if (method === PaymentMethod.NAQD) await addCashMovement(tx, req.user!.id, 'DEBT_PAYMENT', amount, debt.id);
            await writeAudit(tx, req.user!.id, 'DEBT_PAYMENT_RECEIVED', 'CustomerDebt', debt.id, { amount: amount.toString(), method });
            const response = { payment, remaining: updated.remaining.toString(), receipt };
            await saveIdempotentResult(tx, key, req.user!.id, 'DEBT_PAYMENT', hash, debt.id, response);
            return { response, settledOrderId, updatedInventoryIds: [...updatedInventoryIds] };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('debtUpdated', { debtId: req.params.id });
        if (result.settledOrderId) {
            emitSocketEvent('orderUpdate', { orderId: result.settledOrderId, status: OrderStatus.TOLANDI });
            emitSocketEvent('paymentReceived', { orderId: result.settledOrderId, status: OrderStatus.TOLANDI });
        }
        if (result.updatedInventoryIds.length) emitSocketEvent('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.status(201).json({ success: true, data: result.response });
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldigвЂi yetarli emas` });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof Error && error.message === 'DEBT_PAYMENT_INVALID') {
            res.status(409).json({ success: false, message: 'Qarz topilmadi yoki toвЂlov qoldiqdan koвЂp' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Qarz toвЂlovi allaqachon yuborilgan yoki yangilandi' });
            return;
        }
        console.error('Qarz toвЂlovini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qarz toвЂlovini saqlab boвЂlmadi' });
    }
});

router.post('/refunds', async (req, res) => {
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const items = req.body?.items as Array<{ orderItemId?: unknown; quantity?: unknown }> | undefined;
    const method = parseMethod(req.body?.method || 'NAQD');
    if (!key || !orderId || !reason || !method || method === PaymentMethod.QARZ || !Array.isArray(items) ||
        !items.length || new Set(items.map(item => item.orderItemId)).size !== items.length ||
        items.some(item => typeof item.orderItemId !== 'string' ||
            !parseDecimal(item.quantity, quantityPattern)?.greaterThan(0))) {
        res.status(400).json({ success: false, message: 'Qaytarish maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ orderId, reason, method, items });
    try {
        const duplicate = await readIdempotentResult(key, req.user!.id, 'REFUND', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const threshold = parseDecimal(process.env.REFUND_ADMIN_APPROVAL_THRESHOLD || '500000')!;
        const refund = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
            const order = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true, status: true, debt: { select: { remaining: true, payments: { select: { amount: true } } } },
                    payments: { select: { amount: true } },
                    items: { select: { id: true, quantity: true, unitPrice: true } },
                    refunds: { select: { amount: true } }
                }
            });
            if (!order || ([OrderStatus.BEKOR_QILINDI] as OrderStatus[]).includes(order.status)) throw new Error('REFUND_ORDER_INVALID');
            if (order.debt?.remaining.greaterThan(0)) throw new Error('REFUND_OUTSTANDING_DEBT');
            const selectedIds = items.map(item => item.orderItemId as string);
            const orderItems = new Map(order.items.filter(item => selectedIds.includes(item.id)).map(item => [item.id, item]));
            if (orderItems.size !== new Set(selectedIds).size) throw new Error('REFUND_ITEM_INVALID');
            const lineData = [];
            let total = new Prisma.Decimal(0);
            for (const item of items) {
                const orderItem = orderItems.get(item.orderItemId as string)!;
                const quantity = parseDecimal(item.quantity, quantityPattern)!;
                const previouslyReturned = await tx.refundItem.aggregate({
                    where: { orderItemId: orderItem.id },
                    _sum: { quantity: true }
                });
                if (new Prisma.Decimal(previouslyReturned._sum.quantity || 0).plus(quantity).greaterThan(orderItem.quantity)) {
                    throw new Error('REFUND_QUANTITY_EXCEEDED');
                }
                const amount = new Prisma.Decimal(orderItem.unitPrice).mul(quantity);
                total = total.plus(amount);
                lineData.push({ orderItemId: orderItem.id, quantity, amount });
            }
            const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))
                .plus(order.debt?.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)) || new Prisma.Decimal(0));
            const alreadyRefunded = order.refunds.reduce((sum, previous) => sum.plus(previous.amount), new Prisma.Decimal(0));
            if (total.greaterThan(paid.minus(alreadyRefunded))) throw new Error('REFUND_AMOUNT_EXCEEDED');
            if (req.user!.role !== RoleType.ADMIN && total.greaterThan(threshold)) throw new Error('ADMIN_APPROVAL_REQUIRED');
            const created = await tx.refund.create({
                data: {
                    orderId,
                    amount: total,
                    reason,
                    method,
                    cashierId: req.user!.id,
                    ...(req.user!.role === RoleType.ADMIN ? { approvedById: req.user!.id } : {}),
                    idempotencyKey: key,
                    items: { create: lineData }
                },
                include: { items: true }
            });
            if (method === PaymentMethod.NAQD) await addCashMovement(tx, req.user!.id, 'REFUND', total.negated(), orderId, reason);
            const refundedTotal = alreadyRefunded.plus(total);
            const fullyRefunded = refundedTotal.equals(paid);
            if (fullyRefunded) {
                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        status: OrderStatus.QAYTARILDI,
                        statusHistory: { create: { status: OrderStatus.QAYTARILDI, userId: req.user!.id, comment: reason } }
                    }
                });
            }
            await writeAudit(tx, req.user!.id, 'ORDER_REFUNDED', 'Refund', created.id, { amount: total.toString(), orderId, reason });
            const response = { ...created, amount: created.amount.toString() };
            await saveIdempotentResult(tx, key, req.user!.id, 'REFUND', hash, created.id, response);
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('orderUpdate', { orderId, type: 'refund' });
        res.status(201).json({ success: true, data: refund });
    } catch (error) {
        const messages: Record<string, { status: number; message: string }> = {
            IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' },
            REFUND_ORDER_INVALID: { status: 400, message: 'Buyurtmani qaytarib boвЂlmaydi' },
            REFUND_OUTSTANDING_DEBT: { status: 409, message: 'Qarz toвЂlanmaguncha buyurtmani qaytarib boвЂlmaydi' },
            REFUND_ITEM_INVALID: { status: 400, message: 'Buyurtma taomi topilmadi' },
            REFUND_QUANTITY_EXCEEDED: { status: 409, message: 'Qaytarilgan miqdor buyurtma miqdoridan oshdi' },
            REFUND_AMOUNT_EXCEEDED: { status: 409, message: 'Qaytarish summasi olingan toвЂlovdan oshdi' },
            ADMIN_APPROVAL_REQUIRED: { status: 403, message: 'Bu summa uchun Admin tasdigвЂi kerak' }
        };
        if (error instanceof Error && messages[error.message]) {
            const entry = messages[error.message];
            res.status(entry.status).json({ success: false, message: entry.message });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Qaytarish allaqachon yuborilgan yoki buyurtma yangilandi' });
            return;
        }
        console.error('Buyurtmani qaytarishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qaytarishni saqlab boвЂlmadi' });
    }
});

router.get('/expenses', async (req, res) => {
    try {
        const expenses = await prisma.expense.findMany({
            where: req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {},
            include: { cashier: { select: { fullName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 250
        });
        res.json({ success: true, data: expenses });
    } catch (error) {
        console.error('Xarajatlar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xarajatlar tarixini olib boвЂlmadi' });
    }
});

router.post('/expenses', async (req, res) => {
    const amount = parseDecimal(req.body?.amount);
    const method = parseMethod(req.body?.method || 'NAQD');
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 80) : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : '';
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!amount?.greaterThan(0) || !method || method === PaymentMethod.QARZ || !category || !description || !key) {
        res.status(400).json({ success: false, message: 'Xarajat maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ amount: amount.toString(), method, category, description });
    try {
        const duplicate = await readIdempotentResult(key, req.user!.id, 'EXPENSE', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const expense = await prisma.$transaction(async tx => {
            const session = method === PaymentMethod.NAQD ? await openSession(tx, req.user!.id) : null;
            const created = await tx.expense.create({
                data: {
                    amount, method, category, description, cashierId: req.user!.id,
                    ...(session ? { sessionId: session.id } : {})
                }
            });
            if (method === PaymentMethod.NAQD) await addCashMovement(tx, req.user!.id, 'EXPENSE', amount.negated(), created.id, description);
            await writeAudit(tx, req.user!.id, 'EXPENSE_CREATED', 'Expense', created.id, { amount: amount.toString(), category });
            await saveIdempotentResult(tx, key, req.user!.id, 'EXPENSE', hash, created.id, created);
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('cashMovement', { type: 'EXPENSE', expenseId: expense.id });
        res.status(201).json({ success: true, data: expense });
    } catch (error) {
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
            res.status(409).json({ success: false, message: 'Xarajat allaqachon yuborilgan yoki maвЂ™lumot yangilandi' });
            return;
        }
        console.error('Xarajatni saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Xarajatni saqlab boвЂlmadi' });
    }
});

router.get('/register', async (req, res) => {
    try {
        const session = await prisma.cashSession.findFirst({
            where: { cashierId: req.user!.id, activeCashierId: req.user!.id },
            include: { movements: { orderBy: { createdAt: 'desc' }, take: 100 } }
        });
        const expected = session ? await prisma.cashMovement.aggregate({
            where: { sessionId: session.id },
            _sum: { amount: true }
        }) : null;
        res.json({
            success: true,
            data: session ? { ...session, currentExpected: (expected?._sum.amount || new Prisma.Decimal(0)).toString() } : null
        });
    } catch (error) {
        console.error('Kassa smenasini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa smenasini olib boвЂlmadi' });
    }
});

router.post('/register/open', async (req, res) => {
    const startingBalance = parseDecimal(req.body?.startingBalance);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!startingBalance || !key || (req.body?.terminalId !== undefined &&
        (typeof req.body.terminalId !== 'string' || req.body.terminalId.length > 100))) {
        res.status(400).json({ success: false, message: 'BoshlangвЂich kassa summasi notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ startingBalance: startingBalance.toString(), terminalId: req.body?.terminalId || null });
    try {
        const duplicate = await readIdempotentResult(key, req.user!.id, 'REGISTER_OPEN', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const session = await prisma.$transaction(async tx => {
            const active = await openSession(tx, req.user!.id);
            if (active) throw new Error('REGISTER_ALREADY_OPEN');
            const created = await tx.cashSession.create({
                data: {
                    cashierId: req.user!.id,
                    activeCashierId: req.user!.id,
                    startingBalance,
                    ...(req.body?.terminalId ? { terminalId: req.body.terminalId } : {})
                }
            });
            await tx.cashMovement.create({ data: { sessionId: created.id, userId: req.user!.id, type: 'OPENING', amount: startingBalance } });
            await writeAudit(tx, req.user!.id, 'REGISTER_OPENED', 'CashSession', created.id, { startingBalance: startingBalance.toString() });
            await saveIdempotentResult(tx, key, req.user!.id, 'REGISTER_OPEN', hash, created.id, created);
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('cashRegisterUpdated', { cashierId: req.user!.id, status: 'OPEN' });
        res.status(201).json({ success: true, data: session });
    } catch (error) {
        if (error instanceof Error && error.message === 'REGISTER_ALREADY_OPEN') {
            res.status(409).json({ success: false, message: 'Kassa allaqachon ochiq' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Faol kassa smenasi allaqachon mavjud' });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Kassa smenasi bir vaqtda oвЂzgardi' });
            return;
        }
        console.error('Kassani ochishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassani ochib boвЂlmadi' });
    }
});

router.post('/register/close', async (req, res) => {
    const actualCash = parseDecimal(req.body?.actualCash);
    const key = getIdempotencyKey(req.body?.idempotencyKey);
    if (!actualCash || !key) {
        res.status(400).json({ success: false, message: 'Amaldagi kassa summasi notoвЂgвЂri' });
        return;
    }
    const hash = requestHash({ actualCash: actualCash.toString(), closingNote: req.body?.closingNote || '' });
    try {
        const duplicate = await readIdempotentResult(key, req.user!.id, 'REGISTER_CLOSE', hash);
        if (duplicate) {
            res.json({ success: true, duplicate: true, data: duplicate });
            return;
        }
        const result = await prisma.$transaction(async tx => {
            const session = await tx.cashSession.findFirst({
                where: { cashierId: req.user!.id, activeCashierId: req.user!.id }
            });
            if (!session) throw new Error('REGISTER_NOT_OPEN');
            await tx.$queryRaw`SELECT "id" FROM "CashSession" WHERE "id" = ${session.id} FOR UPDATE`;
            const aggregate = await tx.cashMovement.aggregate({
                where: { sessionId: session.id },
                _sum: { amount: true }
            });
            const expectedCash = new Prisma.Decimal(aggregate._sum.amount || 0);
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
            await writeAudit(tx, req.user!.id, 'REGISTER_CLOSED', 'CashSession', session.id, {
                actualCash: actualCash.toString(), expectedCash: expectedCash.toString(), difference: difference.toString()
            });
            await tx.cashMovement.create({
                data: { sessionId: session.id, userId: req.user!.id, type: 'CLOSING', amount: actualCash, referenceId: session.id }
            });
            const response = { expectedCash: expectedCash.toString(), actualCash: actualCash.toString(), difference: difference.toString(), sessionId: session.id };
            await saveIdempotentResult(tx, key, req.user!.id, 'REGISTER_CLOSE', hash, session.id, response);
            return { closed, ...response };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        emitSocketEvent('cashRegisterUpdated', { cashierId: req.user!.id, status: 'CLOSED' });
        try { await sendShiftCloseReport(req.user!.id, result.sessionId); } catch (e) { console.error('Failed to send shift close report:', e); }
        res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof Error && error.message === 'REGISTER_NOT_OPEN') {
            res.status(409).json({ success: false, message: 'Ochiq kassa smenasi topilmadi' });
            return;
        }
        if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
            res.status(409).json({ success: false, message: 'SoвЂrov identifikatori boshqa amal uchun ishlatilgan' });
            return;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            res.status(409).json({ success: false, message: 'Kassa smenasi bir vaqtda oвЂzgardi' });
            return;
        }
        console.error('Kassani yopishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassani yopib boвЂlmadi' });
    }
});

router.get('/history', async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : dayStartInTashkent();
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        res.status(400).json({ success: false, message: 'Sana oraligвЂi notoвЂgвЂri' });
        return;
    }
    try {
        const where = {
            createdAt: { gte: from, lte: to },
            ...(req.user!.role === RoleType.CASHIER ? { userId: req.user!.id } : {})
        };
        const [movements, sessions] = await Promise.all([
            prisma.cashMovement.findMany({ where, include: { user: { select: { fullName: true, role: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
            prisma.cashSession.findMany({
                where: { openedAt: { gte: from, lte: to }, ...(req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {}) },
                select: { id: true, startingBalance: true, expectedCash: true, actualCash: true, difference: true, openedAt: true, closedAt: true, cashier: { select: { fullName: true } } },
                orderBy: { openedAt: 'desc' },
                take: 200
            })
        ]);
        res.json({ success: true, data: { movements, sessions } });
    } catch (error) {
        console.error('Kassa tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kassa tarixini olib boвЂlmadi' });
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
            prisma.order.findMany({
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
            prisma.customer.findMany({
                where: {
                    
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
    } catch (error) {
        console.error('Kassa umumiy qidiruvida xatolik:', error);
        res.status(500).json({ success: false, message: 'Qidiruvni bajarib boвЂlmadi' });
    }
});

router.get('/orders/:id/timeline', async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
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
                at: item.createdAt, action: 'TOвЂLOV', employee: item.cashier.fullName, role: item.cashier.role, details: `${item.amount} ${item.method}`
            })),
            ...order.refunds.map(item => ({
                at: item.createdAt, action: 'QAYTARISH', employee: item.cashier.fullName, role: RoleType.CASHIER, details: `${item.amount} soвЂm вЂ” ${item.reason}`
            })),
            ...(order.createdBy ? [{
                at: order.createdAt, action: 'ORDER_SOURCE', employee: order.createdBy.fullName, role: order.createdBy.role, details: order.source
            }] : [])
        ].sort((left, right) => left.at.getTime() - right.at.getTime());
        res.json({ success: true, data: { order, entries } });
    } catch (error) {
        console.error('Buyurtma tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Buyurtma tarixini olib boвЂlmadi' });
    }
});

router.get('/waiter-calls', async (_req, res) => {
    try {
        const calls = await prisma.waiterCall.findMany({
            where: { status: { not: 'YAKUNLANDI' }, kind: 'CASHIER_ASSIST' },
            include: {
                table: { select: { number: true, room: { select: { name: true } } } },
                calledBy: { select: { fullName: true, role: true } }
            },
            orderBy: { createdAt: 'asc' },
            take: 100
        });
        res.json({ success: true, data: calls });
    } catch (error) {
        console.error('Ofitsiant chaqiruvlarini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruvlarni olib boвЂlmadi' });
    }
});

router.post('/waiter-calls/:id/status', async (req, res) => {
    const next = req.body?.status;
    if (!['QABUL_QILINDI', 'YAKUNLANDI'].includes(next)) {
        res.status(400).json({ success: false, message: 'Chaqiruv holati notoвЂgвЂri' });
        return;
    }
    try {
        const call = await prisma.waiterCall.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
        if (!call || call.status === 'YAKUNLANDI') {
            res.status(404).json({ success: false, message: 'Faol chaqiruv topilmadi' });
            return;
        }
        const updated = await prisma.waiterCall.update({
            where: { id: call.id },
            data: next === 'QABUL_QILINDI'
                ? { status: next, acceptedById: req.user!.id }
                : { status: next, completedById: req.user!.id }
        });
        await prisma.auditLog.create({
            data: { userId: req.user!.id, action: `WAITER_CALL_${next}`, entity: 'WaiterCall', entityId: call.id }
        });
        emitSocketEvent('waiter_call_updated', { callId: call.id, status: updated.status });
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('Ofitsiant chaqiruvini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chaqiruv holatini yangilab boвЂlmadi' });
    }
});

router.get('/reports', async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : dayStartInTashkent();
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        res.status(400).json({ success: false, message: 'Hisobot sanalari notoвЂgвЂri' });
        return;
    }
    const cashierFilter = req.user!.role === RoleType.CASHIER ? { cashierId: req.user!.id } : {};
    try {
        const [payments, expenses, refunds, debts, debtPayments, orders] = await Promise.all([
            prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            prisma.expense.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            prisma.refund.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            prisma.customerDebt.aggregate({ where: { createdAt: { gte: from, lte: to }, ...(req.user!.role === RoleType.CASHIER ? { createdById: req.user!.id } : {}) }, _sum: { amount: true } }),
            prisma.debtPayment.aggregate({ where: { createdAt: { gte: from, lte: to }, ...cashierFilter }, _sum: { amount: true } }),
            prisma.order.groupBy({ by: ['orderType'], where: { createdAt: { gte: from, lte: to }, ...(req.user!.role === RoleType.CASHIER ? { createdById: req.user!.id } : {}) }, _count: { id: true }, _sum: { totalAmount: true } })
        ]);
        res.json({
            success: true,
            data: {
                payments: Object.fromEntries(payments.map(item => [item.method, (item._sum.amount || new Prisma.Decimal(0)).toString()])),
                expenses: (expenses._sum.amount || new Prisma.Decimal(0)).toString(),
                refunds: (refunds._sum.amount || new Prisma.Decimal(0)).toString(),
                debtsCreated: (debts._sum.amount || new Prisma.Decimal(0)).toString(),
                debtsCollected: (debtPayments._sum.amount || new Prisma.Decimal(0)).toString(),
                orders: Object.fromEntries(orders.map(item => [item.orderType, {
                    count: item._count.id, amount: (item._sum.totalAmount || new Prisma.Decimal(0)).toString()
                }]))
            }
        });
    } catch (error) {
        console.error('Kassir hisobotini tuzishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Hisobotni olib boвЂlmadi' });
    }
});

router.get('/receipts', async (req, res) => {
    try {
        const receipts = await prisma.receipt.findMany({
            where: req.user!.role === RoleType.CASHIER ? {
                order: { OR: [
                    { payments: { some: { cashierId: req.user!.id } } },
                    { debt: { createdById: req.user!.id } },
                    { debt: { payments: { some: { cashierId: req.user!.id } } } }
                ] }
            } : {},
            include: { order: { select: { id: true, orderNumber: true, orderType: true, totalAmount: true, createdAt: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        });
        res.json({ success: true, data: receipts });
    } catch (error) {
        console.error('Cheklar tarixini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Cheklar tarixini olib boвЂlmadi' });
    }
});

router.post('/receipts/:id/reprint', async (req, res) => {
    try {
        const receipt = await prisma.receipt.findUnique({
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
        if (!receipt || (req.user!.role === RoleType.CASHIER &&
            !receipt.order.payments.some(payment => payment.cashierId === req.user!.id) &&
            receipt.order.debt?.createdById !== req.user!.id &&
            !receipt.order.debt?.payments.some(payment => payment.cashierId === req.user!.id))) {
            res.status(404).json({ success: false, message: 'Chek topilmadi' });
            return;
        }
        const lastJob = receipt.order.printJobs[0];
        if (!lastJob) {
            res.status(409).json({ success: false, message: 'Chek uchun chop etish maвЂ™lumoti topilmadi' });
            return;
        }
        const job = await prisma.printJob.create({
            data: { orderId: receipt.orderId, payload: lastJob.payload, status: 'KUTILMOQDA', jobType: 'RECEIPT' }
        });
        await prisma.auditLog.create({
            data: { userId: req.user!.id, action: 'RECEIPT_REPRINT_QUEUED', entity: 'Receipt', entityId: receipt.id }
        });
        res.status(201).json({ success: true, data: { jobId: job.id, payload: JSON.parse(job.payload), status: job.status } });
    } catch (error) {
        console.error('Chekni qayta chop etish navbatiga qoвЂyishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Chekni chop etishga tayyorlab boвЂlmadi' });
    }
});

router.get('/printers', requireRole(['ADMIN']), async (_req, res) => {
    try {
        const printers = await prisma.printer.findMany({
            select: { id: true, name: true, department: true, ipAddress: true, port: true },
            orderBy: { department: 'asc' }
        });
        res.json({ success: true, data: printers.map(printer => ({ ...printer, status: true ? 'CONFIGURED' : 'DISABLED' })) });
    } catch (error) {
        console.error('Printerlar holatini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Printerlar holatini olib boвЂlmadi' });
    }
});

router.get('/packaging', async (_req, res) => {
    try {
        const options = await prisma.packagingOption.findMany({
            where: {  inventory: {  } },
            select: { id: true, name: true, sellingPrice: true, inventory: { select: { id: true, unit: true, quantity: true } } },
            orderBy: { name: 'asc' }
        });
        res.json({ success: true, data: options });
    } catch (error) {
        console.error('Qadoqlash roвЂyxatini olishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qadoqlash roвЂyxatini olib boвЂlmadi' });
    }
});

router.post('/packaging', requireRole(['ADMIN']), async (req, res) => {
    const inventoryId = typeof req.body?.inventoryId === 'string' ? req.body.inventoryId : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    const sellingPrice = parseDecimal(req.body?.sellingPrice);
    if (!inventoryId || !name || !sellingPrice) {
        res.status(400).json({ success: false, message: 'Qadoqlash maвЂ™lumotlari notoвЂgвЂri' });
        return;
    }
    try {
        const inventory = await prisma.inventoryProduct.findFirst({ where: { id: inventoryId }, select: { id: true } });
        if (!inventory) {
            res.status(400).json({ success: false, message: 'Faol ombor mahsuloti topilmadi' });
            return;
        }
        const option = await prisma.packagingOption.upsert({
            where: { inventoryId },
            create: { inventoryId, name, sellingPrice },
            update: { name, sellingPrice }
        });
        res.status(201).json({ success: true, data: option });
    } catch (error) {
        console.error('Qadoqlash sozlamasini saqlashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Qadoqlash sozlamasini saqlab boвЂlmadi' });
    }
});

router.post('/orders/:id/verify-pickup', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ success: false, message: '6 xonali tasdiqlash kodini kiriting' });
        return;
    }
    try {
        const result = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const verification = await tx.takeawayVerification.findUnique({
                where: { orderId: req.params.id },
                include: { order: { select: { id: true, orderNumber: true, orderType: true, status: true } } }
            });
            if (!verification || verification.order.orderType !== OrderType.TAKEAWAY ||
                verification.expiresAt < new Date() || verification.usedAt || verification.attempts >= 5) {
                return { failure: 'VERIFICATION_UNAVAILABLE' as const };
            }
            if (!matchesVerification(code, verification.codeHash)) {
                await tx.takeawayVerification.update({ where: { id: verification.id }, data: { attempts: { increment: 1 } } });
                await writeAudit(tx, req.user!.id, 'TAKEAWAY_VERIFICATION_FAILED', 'Order', req.params.id, {
                    attempt: verification.attempts + 1
                });
                return { failure: 'VERIFICATION_INVALID' as const };
            }
            if (!([OrderStatus.TOLANDI, OrderStatus.QISMAN_TOLANDI] as OrderStatus[]).includes(verification.order.status)) {
                return { failure: 'ORDER_NOT_PAID' as const };
            }
            const updatedInventoryIds = await deductOrderRecipes(tx, req.params.id, req.user!.id);
            const updated = await tx.order.update({
                where: { id: req.params.id },
                data: {
                    status: OrderStatus.YAKUNLANDI,
                    completedAt: new Date(),
                    statusHistory: { create: { status: OrderStatus.YAKUNLANDI, userId: req.user!.id, comment: 'Olib ketish kodi tasdiqlandi' } }
                }
            });
            await tx.takeawayVerification.update({
                where: { id: verification.id },
                data: { usedAt: new Date(), verifiedById: req.user!.id }
            });
            await deductPackaging(tx, updated.id, req.user!.id);
            await writeAudit(tx, req.user!.id, 'TAKEAWAY_PICKED_UP', 'Order', updated.id);
            return { order: updated, updatedInventoryIds };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if ('failure' in result) {
            const responses = {
                VERIFICATION_INVALID: { status: 400, message: 'Tasdiqlash kodi notoвЂgвЂri' },
                VERIFICATION_UNAVAILABLE: { status: 409, message: 'Kod bekor boвЂlgan, muddati tugagan yoki urinishlar soni oshgan' },
                ORDER_NOT_PAID: { status: 409, message: 'Buyurtma toвЂlov holatida emas' }
            };
            const response = responses[result.failure];
            res.status(response.status).json({ success: false, message: response.message });
            return;
        }
        emitSocketEvent('orderUpdate', { orderId: result.order.id, status: result.order.status });
        if (result.updatedInventoryIds.length) emitSocketEvent('inventory_updated', { inventoryIds: result.updatedInventoryIds });
        res.json({ success: true, message: 'Tasdiqlash kodi qabul qilindi, buyurtma topshirildi' });
    } catch (error) {
        if (error instanceof Error && error.message === 'PACKAGING_STOCK_SHORT') {
            res.status(409).json({ success: false, message: 'Qadoqlash mahsuloti qoldigвЂi yetarli emas' });
            return;
        }
        if (error instanceof Error && error.message.startsWith('RECIPE_STOCK_SHORT:')) {
            res.status(409).json({ success: false, message: `${error.message.slice('RECIPE_STOCK_SHORT:'.length)} ombor qoldigвЂi yetarli emas` });
            return;
        }
        console.error('Olib ketish kodini tekshirishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Kodni tekshirib boвЂlmadi' });
    }
});

router.post('/orders/:id/verification/renew', requireRole(['ADMIN']), async (req, res) => {
    const code = String(randomInt(100000, 1000000));
    try {
        const renewed = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const verification = await tx.takeawayVerification.findUnique({
                where: { orderId: req.params.id },
                include: { order: { select: { id: true, orderNumber: true, orderType: true, customer: { select: { telegramId: true } } } } }
            });
            if (!verification || verification.order.orderType !== OrderType.TAKEAWAY || verification.usedAt) {
                throw new Error('VERIFICATION_CANNOT_RENEW');
            }
            const updated = await tx.takeawayVerification.update({
                where: { id: verification.id },
                data: { codeHash: makeVerification(code), expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), attempts: 0 }
            });
            await writeAudit(tx, req.user!.id, 'TAKEAWAY_VERIFICATION_RENEWED', 'Order', verification.order.id, {
                orderNumber: verification.order.orderNumber
            });
            return { updated, telegramId: verification.order.customer?.telegramId };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
            if (!response.ok) console.error('Yangi Telegram kodi yuborilmadi:', await response.text());
        }
        res.json({ success: true, data: { expiresAt: renewed.updated.expiresAt, code, telegramSent } });
    } catch (error) {
        if (error instanceof Error && error.message === 'VERIFICATION_CANNOT_RENEW') {
            res.status(409).json({ success: false, message: 'Bu buyurtma uchun kodni yangilab boвЂlmaydi' });
            return;
        }
        console.error('Olib ketish kodini yangilashda xatolik:', error);
        res.status(500).json({ success: false, message: 'Tasdiqlash kodini yangilab boвЂlmadi' });
    }
});

router.post('/admin-access', async (req, res) => {
    if (req.user!.role !== RoleType.CASHIER) {
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
        const admin = await prisma.user.findUnique({
            where: { username },
            select: { id: true, role: true, fullName: true, passwordHash: true, updatedAt: true }
        });
        if (!admin  || admin.role !== RoleType.ADMIN || !await verifyPassword(password, admin.passwordHash)) {
            res.status(401).json({ success: false, message: 'Admin login yoki paroli notoвЂgвЂri' });
            return;
        }
        const access = await prisma.$transaction(async tx => {
            const created = await tx.adminTerminalAccess.create({
                data: { cashierId: req.user!.id, adminId: admin.id }
            });
            await writeAudit(tx, admin.id, 'ADMIN_TERMINAL_ACCESS_STARTED', 'AdminTerminalAccess', created.id, {
                cashierId: req.user!.id, cashierName: req.user!.fullName
            });
            return created;
        });
        setTerminalAdminCookie(res, admin, access.id);
        res.json({ success: true, data: { admin: admin.fullName, accessId: access.id, adminUrl: '/admin/' } });
    } catch (error) {
        console.error('Kassir terminalida Admin ruxsatini berishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Admin sessiyasini ochib boвЂlmadi' });
    }
});

router.post('/admin-access/close', requireRole(['ADMIN']), async (req, res) => {
    const accessId = req.user!.terminalAccessId;
    if (!accessId) {
        res.status(409).json({ success: false, message: 'Kassir terminali Admin sessiyasi aniqlanmadi' });
        return;
    }
    try {
        await prisma.$transaction(async tx => {
            const access = await tx.adminTerminalAccess.update({
                where: { id: accessId },
                data: { endedAt: new Date() }
            });
            await writeAudit(tx, access.adminId, 'ADMIN_TERMINAL_ACCESS_ENDED', 'AdminTerminalAccess', access.id, {
                cashierId: access.cashierId
            });
        });
        clearTerminalAdminCookie(res);
        res.json({ success: true, message: 'Kassir rejimiga qaytdingiz' });
    } catch (error) {
        console.error('Admin terminal sessiyasini yopishda xatolik:', error);
        res.status(500).json({ success: false, message: 'Admin sessiyasini yopib boвЂlmadi' });
    }
});

async function sendShiftCloseReport(cashierId: string, sessionId: string) {
  const [session, payments, expenses, refunds] = await Promise.all([
    prisma.cashSession.findUnique({ where: { id: sessionId }, select: { closedAt: true, startingBalance: true, expectedCash: true, actualCash: true, difference: true } }),
    prisma.payment.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true, method: true } }),
    prisma.expense.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true } }),
    prisma.refund.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true } })
  ]);
  const totalRevenue = payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const cashPayments = payments.filter(p => p.method === PaymentMethod.NAQD).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const cardPayments = payments.filter(p => p.method === PaymentMethod.PLASTIK).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const electronicPayments = payments.filter(p => p.method === PaymentMethod.ELEKTRON).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const totalExpenses = expenses.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
  const totalRefunds = refunds.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  const lines = [
    `Smena yopilgan: ${session?.closedAt ? new Date(session.closedAt).toLocaleString("uz-UZ") : ''}`,
    `Boshlang'ich balans: ${session?.startingBalance?.toString() || "0"}`,
    `Kutilayotgan naqd: ${session?.expectedCash?.toString() || "0"}`,
    `Amaldagi naqd: ${session?.actualCash?.toString() || "0"}`,
    `Farq: ${session?.difference?.toString() || "0"}`,
    `Umumiy tushum: ${totalRevenue.toString()}`,
    `Naqd to'lovlar: ${cashPayments.toString()}`,
    `Plastik to'lovlar: ${cardPayments.toString()}`,
    `Elektron to'lovlar: ${electronicPayments.toString()}`,
    `Xarajatlar: ${totalExpenses.toString()}`,
`Qaytarishlar: ${totalRefunds.toString()}`,
  ];
  await sendToActiveSubscribers(formatTelegramMessage('Smena hisobi', lines));
}

export default router;




