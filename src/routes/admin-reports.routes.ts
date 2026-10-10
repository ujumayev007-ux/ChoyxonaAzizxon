import { OrderStatus, OrderType, PaymentMethod, Prisma, RoleType } from '@prisma/client';
import { Request, Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { prisma } from '../utils/db';

const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));

const zero = new Prisma.Decimal(0);
const salesStatuses: OrderStatus[] = [
    OrderStatus.QISMAN_TOLANDI,
    OrderStatus.TOLANDI,
    OrderStatus.YAKUNLANDI,
    OrderStatus.QAYTARILDI
];
const validSections = new Set([
    'summary', 'foods', 'waiters', 'cashiers', 'inventory', 'expenses',
    'refunds', 'orders', 'customers', 'loyal-customers', 'takeaway', 'audit', 'telegram'
]);

interface ReportFilters {
    from: Date;
    to: Date;
    waiterId?: string;
    cashierId?: string;
    dishId?: string;
    categoryId?: string;
    paymentMethod?: PaymentMethod;
    orderType?: OrderType;
    search?: string;
}

interface TrendRow {
    bucket: Date;
    amount: Prisma.Decimal;
    orders: number;
}

const money = (value: Prisma.Decimal | null | undefined): string => (value || zero).toString();

function tashkentDayStart(date = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 5 * 60 * 60 * 1000);
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function readFilters(query: Request['query']): Promise<ReportFilters | string> {
    const from = query.from === undefined ? tashkentDayStart() : parseDate(query.from);
    const to = query.to === undefined ? new Date(tashkentDayStart().getTime() + 24 * 60 * 60 * 1000 - 1) : parseDate(query.to);
    if (!from || !to || from > to || to.getTime() - from.getTime() > 3660 * 24 * 60 * 60 * 1000) {
        return 'Hisobot sanalari notoвЂgвЂri yoki 10 yildan uzun';
    }

    const filters: ReportFilters = { from, to };
    if (query.search !== undefined) {
        if (typeof query.search !== 'string' || query.search.length > 100) return 'Qidiruv matni notoвЂgвЂri';
        filters.search = query.search.trim();
    }
    const idFields = ['waiterId', 'cashierId', 'dishId', 'categoryId'] as const;
    for (const field of idFields) {
        const value = query[field];
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || value.length > 100) return 'Hisobot filtri notoвЂgвЂri';
        filters[field] = value;
    }
    if (filters.waiterId || filters.cashierId) {
        const [waiter, cashier] = await Promise.all([
            filters.waiterId
                ? prisma.user.findFirst({ where: { id: filters.waiterId, role: RoleType.WAITER }, select: { id: true } })
                : null,
            filters.cashierId
                ? prisma.user.findFirst({ where: { id: filters.cashierId, role: RoleType.CASHIER }, select: { id: true } })
                : null
        ]);
        if ((filters.waiterId && !waiter) || (filters.cashierId && !cashier)) {
            return 'Tanlangan xodim topilmadi';
        }
    }
    if (filters.dishId && !(await prisma.menuItem.findUnique({ where: { id: filters.dishId }, select: { id: true } }))) {
        return 'Tanlangan taom topilmadi';
    }
    if (filters.categoryId && !(await prisma.menuCategory.findUnique({ where: { id: filters.categoryId }, select: { id: true } }))) {
        return 'Tanlangan kategoriya topilmadi';
    }

    if (query.paymentMethod !== undefined) {
        if (typeof query.paymentMethod !== 'string' || !Object.values(PaymentMethod).includes(query.paymentMethod as PaymentMethod)) {
            return 'ToвЂlov turi notoвЂgвЂri';
        }
        filters.paymentMethod = query.paymentMethod as PaymentMethod;
    }
    if (query.orderType !== undefined) {
        if (typeof query.orderType !== 'string' || !Object.values(OrderType).includes(query.orderType as OrderType)) {
            return 'Buyurtma turi notoвЂgвЂri';
        }
        filters.orderType = query.orderType as OrderType;
    }
    return filters;
}

function orderAttributes(filters: ReportFilters): Prisma.OrderWhereInput {
    return {
        ...(filters.waiterId ? { waiterId: filters.waiterId } : {}),
        ...(filters.orderType ? { orderType: filters.orderType } : {}),
        ...(filters.dishId ? { items: { some: { menuItemId: filters.dishId } } } : {}),
        ...(filters.categoryId ? { items: { some: { menuItem: { categoryId: filters.categoryId } } } } : {})
    };
}

function orderWhere(filters: ReportFilters): Prisma.OrderWhereInput {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...orderAttributes(filters),
        ...(filters.paymentMethod || filters.cashierId ? {
            payments: { some: {
                ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
                ...(filters.cashierId ? { cashierId: filters.cashierId } : {})
            } }
        } : {})
    };
}

function salesWhere(filters: ReportFilters): Prisma.OrderWhereInput {
    return { ...orderWhere(filters), status: { in: salesStatuses } };
}

function paymentWhere(filters: ReportFilters): Prisma.PaymentWhereInput {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        order: orderAttributes(filters)
    };
}

function debtPaymentWhere(filters: ReportFilters): Prisma.DebtPaymentWhereInput {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        debt: { order: orderAttributes(filters) }
    };
}

function expenseWhere(filters: ReportFilters): Prisma.ExpenseWhereInput {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {})
    };
}

function refundWhere(filters: ReportFilters): Prisma.RefundWhereInput {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        order: orderAttributes(filters)
    };
}

function dateBucket(from: Date, to: Date): 'hour' | 'day' | 'week' | 'month' {
    const duration = to.getTime() - from.getTime();
    if (duration <= 2 * 24 * 60 * 60 * 1000) return 'hour';
    if (duration <= 60 * 24 * 60 * 60 * 1000) return 'day';
    if (duration <= 365 * 24 * 60 * 60 * 1000) return 'week';
    return 'month';
}

async function getSalesTrend(filters: ReportFilters): Promise<TrendRow[]> {
    const conditions: Prisma.Sql[] = [
        Prisma.sql`x."createdAt" >= ${filters.from}`,
        Prisma.sql`x."createdAt" <= ${filters.to}`
    ];
    if (filters.cashierId) conditions.push(Prisma.sql`x."cashierId" = ${filters.cashierId}`);
    if (filters.paymentMethod) conditions.push(Prisma.sql`x."method" = ${filters.paymentMethod}`);
    if (filters.waiterId) conditions.push(Prisma.sql`o."waiterId" = ${filters.waiterId}`);
    if (filters.orderType) conditions.push(Prisma.sql`o."orderType" = ${filters.orderType}::"OrderType"`);
    if (filters.dishId) {
        conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id" AND oi."menuItemId" = ${filters.dishId})`);
    }
    if (filters.categoryId) {
        conditions.push(Prisma.sql`EXISTS (
            SELECT 1 FROM "OrderItem" oi JOIN "MenuItem" mi ON mi."id" = oi."menuItemId"
            WHERE oi."orderId" = o."id" AND mi."categoryId" = ${filters.categoryId}
        )`);
    }
    const where = Prisma.join(conditions, ' AND ');
    const bucket = Prisma.raw(`'${dateBucket(filters.from, filters.to)}'`);
    return prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT date_trunc(${bucket}, x."createdAt") AS bucket,
               SUM(x."amount") AS amount,
               COUNT(DISTINCT x."orderId")::int AS orders
        FROM (
            SELECT p."createdAt", p."amount", p."orderId", p."cashierId", p."method"
            FROM "Payment" p
            UNION ALL
            SELECT dp."createdAt", dp."amount", cd."orderId", dp."cashierId", dp."method"
            FROM "DebtPayment" dp
            JOIN "CustomerDebt" cd ON cd."id" = dp."debtId"
        ) x
        JOIN "Order" o ON o."id" = x."orderId"
        WHERE ${where}
        GROUP BY date_trunc(${bucket}, x."createdAt")
        ORDER BY bucket
    `);
}

async function financialTrend(source: 'expense' | 'refund', filters: ReportFilters) {
    const bucket = Prisma.raw(`'${dateBucket(filters.from, filters.to)}'`);
    const conditions: Prisma.Sql[] = [
        Prisma.sql`${Prisma.raw(source === 'expense' ? 'e' : 'r')}."createdAt" >= ${filters.from}`,
        Prisma.sql`${Prisma.raw(source === 'expense' ? 'e' : 'r')}."createdAt" <= ${filters.to}`
    ];
    const alias = Prisma.raw(source === 'expense' ? 'e' : 'r');
    if (filters.cashierId) conditions.push(Prisma.sql`${alias}."cashierId" = ${filters.cashierId}`);
    if (filters.paymentMethod) conditions.push(Prisma.sql`${alias}."method" = ${filters.paymentMethod}`);
    if (source === 'refund') {
        if (filters.waiterId) conditions.push(Prisma.sql`o."waiterId" = ${filters.waiterId}`);
        if (filters.orderType) conditions.push(Prisma.sql`o."orderType" = ${filters.orderType}::"OrderType"`);
        if (filters.dishId) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "RefundItem" ri JOIN "OrderItem" oi ON oi."id" = ri."orderItemId" WHERE ri."refundId" = r."id" AND oi."menuItemId" = ${filters.dishId})`);
        if (filters.categoryId) conditions.push(Prisma.sql`EXISTS (
            SELECT 1 FROM "RefundItem" ri JOIN "OrderItem" oi ON oi."id" = ri."orderItemId"
            JOIN "MenuItem" mi ON mi."id" = oi."menuItemId"
            WHERE ri."refundId" = r."id" AND mi."categoryId" = ${filters.categoryId}
        )`);
    }
    const where = Prisma.join(conditions, ' AND ');
    const rows = source === 'expense'
        ? await prisma.$queryRaw<Array<{ bucket: Date; amount: Prisma.Decimal; count: number }>>(Prisma.sql`
            SELECT date_trunc(${bucket}, e."createdAt") AS bucket, SUM(e."amount") AS amount, COUNT(e."id")::int AS count
            FROM "Expense" e WHERE ${where}
            GROUP BY date_trunc(${bucket}, e."createdAt") ORDER BY bucket
        `)
        : await prisma.$queryRaw<Array<{ bucket: Date; amount: Prisma.Decimal; count: number }>>(Prisma.sql`
            SELECT date_trunc(${bucket}, r."createdAt") AS bucket, SUM(r."amount") AS amount, COUNT(r."id")::int AS count
            FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId" WHERE ${where}
            GROUP BY date_trunc(${bucket}, r."createdAt") ORDER BY bucket
        `);
    return rows.map(row => ({ date: row.bucket.toISOString(), amount: money(row.amount), count: row.count }));
}

async function menuAggregates(filters: ReportFilters) {
    const itemWhere: Prisma.OrderItemWhereInput = {
        order: salesWhere(filters),
        ...(filters.dishId ? { menuItemId: filters.dishId } : {}),
        ...(filters.categoryId ? { menuItem: { categoryId: filters.categoryId } } : {})
    };
    const [groups, refundedItems] = await Promise.all([prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: itemWhere,
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } }
    }), prisma.refundItem.groupBy({
        by: ['orderItemId'],
        where: { refund: refundWhere(filters) },
        _sum: { quantity: true, amount: true }
    })]);
    const refundedOrderItems = refundedItems.length
        ? await prisma.orderItem.findMany({
            where: { id: { in: refundedItems.map(item => item.orderItemId) } },
            select: { id: true, menuItemId: true }
        })
        : [];
    const itemToMenuId = new Map(refundedOrderItems.map(item => [item.id, item.menuItemId]));
    const refundedByMenu = new Map<string, { quantity: Prisma.Decimal; revenue: Prisma.Decimal }>();
    for (const item of refundedItems) {
        const menuItemId = itemToMenuId.get(item.orderItemId);
        if (!menuItemId) continue;
        const value = refundedByMenu.get(menuItemId) || { quantity: zero, revenue: zero };
        value.quantity = value.quantity.plus(item._sum.quantity || zero);
        value.revenue = value.revenue.plus(item._sum.amount || zero);
        refundedByMenu.set(menuItemId, value);
    }
    const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: groups.map(group => group.menuItemId) } },
        select: { id: true, name: true, unit: true, isActive: true, category: { select: { id: true, name: true, isActive: true } } }
    });
    const byId = new Map(menuItems.map(item => [item.id, item]));
    const items = groups.map(group => {
        const returned = refundedByMenu.get(group.menuItemId);
        const quantity = (group._sum.quantity || zero).minus(returned?.quantity || zero);
        const revenue = (group._sum.totalPrice || zero).minus(returned?.revenue || zero);
        return {
            menuItemId: group.menuItemId,
            name: byId.get(group.menuItemId)?.name || 'NomaвЂ™lum taom',
            unit: byId.get(group.menuItemId)?.unit || 'dona',
            isActive: byId.get(group.menuItemId)?.isActive ?? false,
            categoryId: byId.get(group.menuItemId)?.category.id || null,
            category: byId.get(group.menuItemId)?.category.name || 'NomaвЂ™lum kategoriya',
            categoryActive: byId.get(group.menuItemId)?.category.isActive ?? false,
            quantity: quantity.toString(),
            revenue: revenue.toString()
        };
    }).filter(item => new Prisma.Decimal(item.quantity).greaterThan(0) || new Prisma.Decimal(item.revenue).greaterThan(0));
    return items;
}

async function summary(filters: ReportFilters) {
    const orders = orderWhere(filters);
    const [orderTotals, orderCounts, debt, debtPayments, expenses, refunds, trend, menu, stock, waiterGroups, loyalGroups, paymentGroups, debtPaymentGroups, paymentHistory, debtPaymentHistory] = await Promise.all([
        prisma.order.aggregate({
            where: salesWhere(filters),
            _sum: { totalAmount: true },
            _count: { id: true }
        }),
        prisma.order.count({ where: orders }),
        prisma.customerDebt.aggregate({
            where: {
                createdAt: { gte: filters.from, lte: filters.to },
                ...(filters.cashierId ? { createdById: filters.cashierId } : {}),
                order: orderAttributes(filters)
            },
            _sum: { amount: true }
        }),
        prisma.debtPayment.aggregate({ where: debtPaymentWhere(filters), _sum: { amount: true } }),
        prisma.expense.aggregate({ where: expenseWhere(filters), _sum: { amount: true } }),
        prisma.refund.aggregate({ where: refundWhere(filters), _sum: { amount: true }, _count: { id: true } }),
        getSalesTrend(filters),
        menuAggregates(filters),
        prisma.inventoryProduct.findMany({
            where: {  },
            select: { id: true, quantity: true, minQuantity: true }
        }),
        prisma.order.groupBy({
            by: ['waiterId'],
            where: { ...salesWhere(filters), waiterId: { not: null } },
            _sum: { totalAmount: true },
            _count: { id: true },
            orderBy: { _sum: { totalAmount: 'desc' } },
            take: 1
        }),
        prisma.order.groupBy({
            by: ['customerId'],
            where: { customerId: { not: null }, status: { in: salesStatuses } },
            _count: { id: true }
        }),
        prisma.payment.groupBy({ by: ['method'], where: paymentWhere(filters), _sum: { amount: true } }),
        prisma.debtPayment.groupBy({ by: ['method'], where: debtPaymentWhere(filters), _sum: { amount: true } }),
        prisma.payment.findMany({
            where: paymentWhere(filters),
            select: {
                id: true, amount: true, method: true, createdAt: true,
                cashier: { select: { fullName: true } },
                order: { select: { orderNumber: true, orderType: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        prisma.debtPayment.findMany({
            where: {
                createdAt: { gte: filters.from, lte: filters.to },
                ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
                ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
                debt: { order: orderAttributes(filters) }
            },
            select: {
                id: true, amount: true, method: true, createdAt: true,
                cashier: { select: { fullName: true } },
                debt: { select: { order: { select: { orderNumber: true, orderType: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        })
    ]);
    const orderTypes = await prisma.order.groupBy({
        by: ['orderType'],
        where: salesWhere(filters),
        _sum: { totalAmount: true },
        _count: { id: true }
    });
    const waiter = waiterGroups[0]?.waiterId
        ? await prisma.user.findUnique({ where: { id: waiterGroups[0].waiterId }, select: { fullName: true } })
        : null;
    const topDish = [...menu].sort((left, right) => new Prisma.Decimal(right.quantity).comparedTo(left.quantity))[0];
    const paymentTotals = Object.fromEntries(Object.values(PaymentMethod).map(method => [
        method,
        money(paymentGroups.find(payment => payment.method === method)?._sum.amount)
    ]));
    const collectedByMethod = Object.fromEntries(Object.values(PaymentMethod).map(method => [
        method,
        (paymentGroups.find(payment => payment.method === method)?._sum.amount || zero)
            .plus(debtPaymentGroups.find(payment => payment.method === method)?._sum.amount || zero)
    ]));
    const paymentHistoryRows = [
        ...paymentHistory.map(payment => ({
            id: payment.id, amount: payment.amount.toString(), method: payment.method,
            createdAt: payment.createdAt.toISOString(), cashier: payment.cashier.fullName,
            orderNumber: payment.order.orderNumber, orderType: payment.order.orderType, kind: 'Buyurtma toвЂlovi'
        })),
        ...debtPaymentHistory.map(payment => ({
            id: payment.id, amount: payment.amount.toString(), method: payment.method,
            createdAt: payment.createdAt.toISOString(), cashier: payment.cashier.fullName,
            orderNumber: payment.debt.order.orderNumber, orderType: payment.debt.order.orderType, kind: 'Qarz undirildi'
        }))
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 200);
    const gross = orderTotals._sum.totalAmount || zero;
    const refundAmount = refunds._sum.amount || zero;
    const averageOrderAmount = orderTotals._count.id ? gross.dividedBy(orderTotals._count.id) : zero;
    const topPayment = Object.entries(paymentTotals)
        .sort((left, right) => new Prisma.Decimal(right[1]).comparedTo(left[1]))[0];
    return {
        kpis: {
            grossSales: money(gross),
            netReceipts: money(gross.minus(refundAmount)),
            orders: orderCounts,
            averageCheck: money(averageOrderAmount),
            payments: Object.fromEntries(Object.values(PaymentMethod).map(method => [method, money(collectedByMethod[method])])),
            debt: money(debt._sum.amount),
            debtCollected: money(debtPayments._sum.amount),
            expenses: money(expenses._sum.amount),
            refunds: money(refundAmount),
            refundCount: refunds._count.id
        },
        trend: trend.map(row => ({ date: row.bucket.toISOString(), amount: money(row.amount), orders: row.orders })),
        paymentHistory: paymentHistoryRows,
        orderTypes: orderTypes.map(row => ({ type: row.orderType, amount: money(row._sum.totalAmount), count: row._count.id })),
        ownerSummary: {
            topDish: topDish ? { name: topDish.name, quantity: topDish.quantity, unit: topDish.unit } : null,
            topWaiter: waiter ? { name: waiter.fullName, sales: money(waiterGroups[0]._sum.totalAmount) } : null,
            topPayment: topPayment && new Prisma.Decimal(topPayment[1]).greaterThan(0) ? topPayment : null,
            lowStockCount: stock.filter(product => product.quantity.lessThanOrEqualTo(product.minQuantity)).length,
            loyalCustomers: loyalGroups.filter(group => group._count.id >= 5).length,
            refunds: money(refundAmount),
            expenses: money(expenses._sum.amount)
        }
    };
}

async function foods(filters: ReportFilters) {
    const items = await menuAggregates(filters);
    const total = items.reduce((sum, item) => sum.plus(item.revenue), zero);
    const categories = new Map<string, { category: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal }>();
    for (const item of items) {
        const group = categories.get(item.categoryId || item.category) || {
            category: item.category,
            quantity: zero,
            revenue: zero
        };
        group.quantity = group.quantity.plus(item.quantity);
        group.revenue = group.revenue.plus(item.revenue);
        categories.set(item.categoryId || item.category, group);
    }
    const byQuantity = [...items].sort((a, b) => new Prisma.Decimal(b.quantity).comparedTo(a.quantity));
    return {
        items,
        topQuantity: byQuantity.slice(0, 10),
        topRevenue: [...items].sort((a, b) => new Prisma.Decimal(b.revenue).comparedTo(a.revenue)).slice(0, 10),
        leastSold: byQuantity.slice(-10).reverse(),
        categories: [...categories.values()].map(category => ({
            ...category,
            quantity: category.quantity.toString(),
            revenue: category.revenue.toString(),
            share: total.isZero() ? '0' : category.revenue.dividedBy(total).times(100).toFixed(2)
        }))
    };
}

async function waiters(filters: ReportFilters) {
    const users = await prisma.user.findMany({
        where: { role: RoleType.WAITER, ...(filters.waiterId ? { id: filters.waiterId } : {}) },
        select: { id: true, username: true, fullName: true, waiterProfile: { select: { commissionPercent: true } } },
        orderBy: { fullName: 'asc' }
    });
    const groups = await prisma.order.groupBy({
        by: ['waiterId'],
        where: { ...salesWhere(filters), waiterId: { not: null } },
        _sum: { totalAmount: true },
        _count: { id: true }
    });
    const userIds = users.map(user => user.id);
    const cancelled = await prisma.orderStatusHistory.groupBy({
        by: ['userId'],
        where: {
            userId: { in: userIds },
            createdAt: { gte: filters.from, lte: filters.to },
            status: OrderStatus.BEKOR_QILINDI
        },
        _count: { id: true }
    });
    const refundGroups = await prisma.refund.groupBy({
        by: ['orderId'],
        where: refundWhere(filters),
        _sum: { amount: true }
    });
    const refundedOrders = refundGroups.length
        ? await prisma.order.findMany({
            where: { id: { in: refundGroups.map(group => group.orderId) } },
            select: { id: true, waiterId: true }
        })
        : [];
    const eligibleOrders = await prisma.order.findMany({
        where: { ...salesWhere(filters), waiterId: { in: userIds } },
        select: {
            waiterId: true,
            payments: { select: { amount: true } },
            debt: { select: { payments: { select: { amount: true } } } },
            refunds: { select: { amount: true } }
        }
    });
    const collectedByWaiter = new Map<string, Prisma.Decimal>();
    for (const order of eligibleOrders) {
        if (!order.waiterId) continue;
        const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), zero)
            .plus(order.debt?.payments.reduce((sum, payment) => sum.plus(payment.amount), zero) || zero);
        const refunded = order.refunds.reduce((sum, refund) => sum.plus(refund.amount), zero);
        const netCollected = Prisma.Decimal.max(paid.minus(refunded), zero);
        collectedByWaiter.set(order.waiterId, (collectedByWaiter.get(order.waiterId) || zero).plus(netCollected));
    }
    return users.map(user => {
        const group = groups.find(item => item.waiterId === user.id);
        const refundAmount = refundedOrders.reduce((sum, order) => {
            if (order.waiterId !== user.id) return sum;
            return sum.plus(refundGroups.find(item => item.orderId === order.id)?._sum.amount || zero);
        }, zero);
        const netSales = collectedByWaiter.get(user.id) || zero;
        const commission = netSales.times(user.waiterProfile?.commissionPercent || zero).dividedBy(100);
        return {
            id: user.id,
            name: user.fullName,
            login: user.username,
            workTime: null,
            activeShift: null,
            orders: group?._count.id || 0,
            sales: money(netSales),
            refunds: money(refundAmount),
            cancellations: cancelled.find(item => item.userId === user.id)?._count.id || 0,
            commissionPercent: user.waiterProfile?.commissionPercent.toString() || '0',
            commission: commission.toString()
        };
    });
}

async function cashiers(filters: ReportFilters) {
    const users = await prisma.user.findMany({
        where: { role: RoleType.CASHIER, ...(filters.cashierId ? { id: filters.cashierId } : {}) },
        select: { id: true, username: true, fullName: true },
        orderBy: { fullName: 'asc' }
    });
    const userIds = users.map(user => user.id);
    const sessions = await prisma.cashSession.findMany({
        where: { cashierId: { in: userIds }, openedAt: { lte: filters.to }, OR: [{ closedAt: null }, { closedAt: { gte: filters.from } }] },
        select: {
            id: true, cashierId: true, startingBalance: true, expectedCash: true, actualCash: true,
            difference: true, openedAt: true, closedAt: true
        },
        orderBy: { openedAt: 'desc' },
        take: 500
    });
    const [paymentGroups, expenseGroups, refundGroups, debtGroups, collectedDebtGroups, bookedGroups] = await Promise.all([
        prisma.payment.groupBy({
            by: ['cashierId', 'method'],
            where: paymentWhere(filters),
            _sum: { amount: true }
        }),
        prisma.expense.groupBy({ by: ['cashierId'], where: expenseWhere(filters), _sum: { amount: true } }),
        prisma.refund.groupBy({ by: ['cashierId'], where: refundWhere(filters), _sum: { amount: true } }),
        prisma.customerDebt.groupBy({
            by: ['createdById'],
            where: {
                createdAt: { gte: filters.from, lte: filters.to },
                ...(filters.cashierId ? { createdById: filters.cashierId } : {}),
                order: orderAttributes(filters)
            },
            _sum: { amount: true }
        }),
        prisma.debtPayment.groupBy({ by: ['cashierId', 'method'], where: debtPaymentWhere(filters), _sum: { amount: true } }),
        prisma.order.groupBy({
            by: ['createdById'],
            where: { ...salesWhere(filters), createdById: { in: userIds } },
            _sum: { totalAmount: true }
        })
    ]);
    return users.map(user => {
        const shifts = sessions.filter(session => session.cashierId === user.id);
        const collectedByMethod = (method: PaymentMethod) =>
            (paymentGroups.find(group => group.cashierId === user.id && group.method === method)?._sum.amount || zero)
                .plus(collectedDebtGroups.find(group => group.cashierId === user.id && group.method === method)?._sum.amount || zero);
        const payments: Record<PaymentMethod, string> = {
            [PaymentMethod.NAQD]: money(collectedByMethod(PaymentMethod.NAQD)),
            [PaymentMethod.PLASTIK]: money(collectedByMethod(PaymentMethod.PLASTIK)),
            [PaymentMethod.ELEKTRON]: money(collectedByMethod(PaymentMethod.ELEKTRON)),
            [PaymentMethod.QARZ]: '0'
        };
        return {
            id: user.id,
            name: user.fullName,
            login: user.username,
            payments,
            sales: money(bookedGroups.find(group => group.createdById === user.id)?._sum.totalAmount),
            receipts: money(collectedByMethod(PaymentMethod.NAQD).plus(collectedByMethod(PaymentMethod.PLASTIK)).plus(collectedByMethod(PaymentMethod.ELEKTRON))),
            debtIssued: money(debtGroups.find(group => group.createdById === user.id)?._sum.amount),
            expenses: money(expenseGroups.find(group => group.cashierId === user.id)?._sum.amount),
            refunds: money(refundGroups.find(group => group.cashierId === user.id)?._sum.amount),
            debtCollected: money(collectedDebtGroups.find(group => group.cashierId === user.id)?._sum.amount),
            sessions: shifts.map(session => ({
                id: session.id,
                openedAt: session.openedAt.toISOString(),
                closedAt: session.closedAt?.toISOString() || null,
                durationMinutes: Math.max(0, Math.round((
                    Math.min((session.closedAt || filters.to).getTime(), filters.to.getTime()) -
                    Math.max(session.openedAt.getTime(), filters.from.getTime())
                ) / 60000)),
                openingCash: money(session.startingBalance),
                expectedCash: money(session.expectedCash),
                actualCash: money(session.actualCash),
                difference: money(session.difference)
            }))
        };
    });
}

async function inventory(filters: ReportFilters) {
    const products = await prisma.inventoryProduct.findMany({
        where: {  },
        select: { id: true, name: true, unit: true, quantity: true, minQuantity: true },
        orderBy: { name: 'asc' }
    });
    const [movementGroups, movementRecords, purchaseTotals] = await Promise.all([
        prisma.inventoryTransaction.groupBy({
            by: ['inventoryId', 'type'],
            where: { createdAt: { gte: filters.from, lte: filters.to } },
            _sum: { quantityChange: true }
        }),
        prisma.inventoryTransaction.findMany({
            where: { createdAt: { gte: filters.from, lte: filters.to } },
            select: { inventoryId: true, type: true, quantityChange: true, createdAt: true, inventory: { select: { name: true, unit: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        prisma.purchaseItem.groupBy({
            by: ['inventoryId'],
            where: { purchase: { createdAt: { gte: filters.from, lte: filters.to } } },
            _sum: { quantity: true, totalCost: true },
            _count: { id: true }
        })
    ]);
    const purchaseSpend = purchaseTotals.reduce((sum, item) => sum.plus(item._sum.totalCost || zero), zero);
    const movements = movementRecords.map(transaction => ({
        productId: transaction.inventoryId,
        product: transaction.inventory.name,
        unit: transaction.inventory.unit,
        type: transaction.type,
        quantity: transaction.quantityChange.toString(),
        createdAt: transaction.createdAt.toISOString()
    }));
    return {
        purchaseSpend: purchaseSpend.toString(),
        purchasedProductCount: purchaseTotals.filter(item => item._count.id > 0).length,
        products: products.map(product => ({
            id: product.id, name: product.name, unit: product.unit,
            quantity: product.quantity.toString(), minQuantity: product.minQuantity.toString(),
            low: product.quantity.lessThanOrEqualTo(product.minQuantity),
            used: money(movementGroups.find(group => group.inventoryId === product.id && group.type === 'SOTUV')?._sum.quantityChange?.abs()),
            incoming: money(purchaseTotals.find(item => item.inventoryId === product.id)?._sum.quantity),
            purchaseCost: money(purchaseTotals.find(item => item.inventoryId === product.id)?._sum.totalCost)
        })),
        movements: movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
        movementTypes: [...new Set(movements.map(movement => movement.type))]
    };
}

async function expenses(filters: ReportFilters) {
    const where = expenseWhere(filters);
    const [groups, records, totals, trend] = await Promise.all([
        prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: { id: true }, orderBy: { _sum: { amount: 'desc' } } }),
        prisma.expense.findMany({
            where,
            select: { id: true, amount: true, category: true, description: true, method: true, createdAt: true, cashier: { select: { id: true, fullName: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
        financialTrend('expense', filters)
    ]);
    return {
        total: money(totals._sum.amount),
        count: totals._count.id,
        trend,
        categories: groups.map(group => ({ category: group.category, amount: money(group._sum.amount), count: group._count.id })),
        records: records.map(record => ({ ...record, amount: record.amount.toString(), createdAt: record.createdAt.toISOString() }))
    };
}

async function refunds(filters: ReportFilters) {
    const where = refundWhere(filters);
    const [records, totals, reasons, trend] = await Promise.all([
        prisma.refund.findMany({
            where,
            select: {
                id: true, amount: true, reason: true, method: true, createdAt: true,
                cashier: { select: { id: true, fullName: true, role: true } },
                order: { select: { id: true, orderNumber: true } },
                items: { select: { orderItemId: true, quantity: true, amount: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        prisma.refund.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
        prisma.refund.groupBy({ by: ['reason'], where, _sum: { amount: true }, _count: { id: true } }),
        financialTrend('refund', filters)
    ]);
    const itemIds = [...new Set(records.flatMap(record => record.items.map(item => item.orderItemId)))];
    const orderItems = await prisma.orderItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, menuItem: { select: { name: true, unit: true } } }
    });
    const itemNames = new Map(orderItems.map(item => [item.id, item.menuItem]));
    return {
        total: money(totals._sum.amount),
        count: totals._count.id,
        trend,
        reasons: reasons.map(item => ({ reason: item.reason, amount: money(item._sum.amount), count: item._count.id })),
        records: records.map(record => ({
            ...record,
            amount: record.amount.toString(),
            createdAt: record.createdAt.toISOString(),
            items: record.items.map(item => ({
                name: itemNames.get(item.orderItemId)?.name || 'NomaвЂ™lum taom',
                unit: itemNames.get(item.orderItemId)?.unit || 'dona',
                quantity: item.quantity.toString(),
                amount: item.amount.toString()
            }))
        }))
    };
}

async function ordersReport(filters: ReportFilters) {
    const where = orderWhere(filters);
    const [groups, total, records] = await Promise.all([
        prisma.order.groupBy({ by: ['status', 'orderType'], where, _count: { id: true }, _sum: { totalAmount: true } }),
        prisma.order.count({ where }),
        prisma.order.findMany({
            where,
            select: {
                id: true, orderNumber: true, status: true, orderType: true, totalAmount: true, createdAt: true,
                table: { select: { number: true } },
                waiter: { select: { fullName: true } },
                payments: { select: { method: true, amount: true } },
                debt: { select: { amount: true, remaining: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        })
    ]);
    return {
        total,
        statuses: groups.map(group => ({ status: group.status, type: group.orderType, count: group._count.id, amount: money(group._sum.totalAmount) })),
        records: records.map(record => ({
            ...record,
            totalAmount: record.totalAmount.toString(),
            createdAt: record.createdAt.toISOString(),
            payments: record.payments.map(payment => ({ method: payment.method, amount: payment.amount.toString() })),
            debt: record.debt ? { amount: record.debt.amount.toString(), remaining: record.debt.remaining.toString() } : null
        }))
    };
}

async function customerMetrics(filters: ReportFilters, includeHistory = false) {
    const where = includeHistory ? {} : orderWhere(filters);
    const groups = await prisma.order.groupBy({
        by: ['customerId'],
        where: { ...where, customerId: { not: null }, status: { in: salesStatuses } },
        _sum: { totalAmount: true },
        _count: { id: true },
        _max: { createdAt: true }
    });
    const debtGroups = await prisma.customerDebt.groupBy({
        by: ['customerId'],
        where: { remaining: { gt: 0 } },
        _sum: { remaining: true }
    });
    const searchedIds = filters.search
        ? (await prisma.customer.findMany({
            where: {
                OR: [
                    { firstName: { contains: filters.search, mode: 'insensitive' } },
                    { lastName: { contains: filters.search, mode: 'insensitive' } },
                    { phone: { contains: filters.search } },
                    ...(Number.isSafeInteger(Number(filters.search)) ? [{ customerNumber: Number(filters.search) }] : [])
                ]
            },
            select: { id: true },
            take: 500
        })).map(customer => customer.id)
        : null;
    const candidateIds = groups
        .filter(group => group.customerId)
        .filter(group => !searchedIds || searchedIds.includes(group.customerId!))
        .sort((a, b) => (b._sum.totalAmount || zero).comparedTo(a._sum.totalAmount || zero))
        .slice(0, 500)
        .map(group => group.customerId!);
    const customers = await prisma.customer.findMany({
        where: {
            id: { in: candidateIds },
            ...(filters.cashierId ? { orders: { some: { payments: { some: { cashierId: filters.cashierId } } } } } : {})
        },
        select: { id: true, firstName: true, lastName: true, phone: true, customerNumber: true, createdAt: true, _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500
    });
    const byId = new Map(customers.map(customer => [customer.id, customer]));
    const rows = groups
        .filter(group => group.customerId && byId.has(group.customerId))
        .map(group => {
            const customer = byId.get(group.customerId!)!;
            const count = group._count.id;
            const spend = group._sum.totalAmount || zero;
            return {
                id: customer.id,
                customerNumber: customer.customerNumber,
                name: `${customer.firstName} ${customer.lastName}`.trim() || `Mijoz #${customer.customerNumber}`,
                phone: customer.phone || '',
                visits: count,
                orders: count,
                purchases: spend.toString(),
                averageCheck: count ? spend.dividedBy(count).toString() : '0',
                lastVisit: group._max.createdAt?.toISOString() || null,
                debt: money(debtGroups.find(debt => debt.customerId === customer.id)?._sum.remaining),
                createdAt: customer.createdAt.toISOString()
            };
        }).sort((a, b) => Number(b.purchases) - Number(a.purchases));
    return rows.slice(0, 200);
}

async function customersReport(filters: ReportFilters) {
    const [rows, total, newCustomers, orderTotals] = await Promise.all([
        customerMetrics(filters),
        prisma.customer.count(),
        prisma.customer.count({ where: { createdAt: { gte: filters.from, lte: filters.to } } }),
        prisma.order.aggregate({
            where: { ...salesWhere(filters), customerId: { not: null } },
            _sum: { totalAmount: true },
            _avg: { totalAmount: true }
        })
    ]);
    const allCustomersWithOrders = await prisma.order.groupBy({
        by: ['customerId'],
        where: { ...salesWhere(filters), customerId: { not: null } },
        _count: { id: true }
    });
    return {
        total,
        newCustomers,
        returningCustomers: allCustomersWithOrders.filter(group => group._count.id > 1).length,
        purchases: money(orderTotals._sum.totalAmount),
        averageSpend: money(orderTotals._avg.totalAmount),
        records: rows
    };
}

async function loyalCustomers() {
    const allTime: ReportFilters = { from: new Date(0), to: new Date() };
    const rows = await customerMetrics(allTime, true);
    const now = Date.now();
    const ranked = rows.map(row => {
        const recencyDays = row.lastVisit ? Math.floor((now - new Date(row.lastVisit).getTime()) / 86400000) : Number.MAX_SAFE_INTEGER;
        const spend = new Prisma.Decimal(row.purchases);
        const averageCheck = new Prisma.Decimal(row.averageCheck);
        const level = row.orders >= 30 && spend.greaterThanOrEqualTo(20000000) && averageCheck.greaterThanOrEqualTo(750000) && recencyDays <= 45 ? 'VIP'
            : row.orders >= 15 && spend.greaterThanOrEqualTo(10000000) && averageCheck.greaterThanOrEqualTo(500000) && recencyDays <= 60 ? 'Gold'
            : row.orders >= 5 && spend.greaterThanOrEqualTo(2000000) && averageCheck.greaterThanOrEqualTo(200000) && recencyDays <= 90 ? 'Silver'
            : 'Bronze';
        return { ...row, recencyDays, averageCheck: row.averageCheck, level };
    });
    return {
        thresholds: {
            silver: '5+ buyurtma, 2 mln soвЂm+, oвЂrtacha chek 200 ming soвЂm+, oxirgi tashrif 90 kun ichida',
            gold: '15+ buyurtma, 10 mln soвЂm+, oвЂrtacha chek 500 ming soвЂm+, oxirgi tashrif 60 kun ichida',
            vip: '30+ buyurtma, 20 mln soвЂm+, oвЂrtacha chek 750 ming soвЂm+, oxirgi tashrif 45 kun ichida',
            reengageAfterDays: 90
        },
        levels: ['Bronze', 'Silver', 'Gold', 'VIP'].map(level => ({ level, count: ranked.filter(row => row.level === level).length })),
        reengagement: ranked.filter(row => row.orders >= 5 && row.recencyDays > 90).slice(0, 100),
        topCustomers: ranked.sort((a, b) => new Prisma.Decimal(b.purchases).comparedTo(a.purchases)).slice(0, 100)
    };
}

async function takeaway(filters: ReportFilters) {
    const where = { ...orderWhere(filters), orderType: OrderType.TAKEAWAY };
    const compareFilters = { ...filters, orderType: undefined };
    const [orders, count, totals, paidCount, partiallyPaidCount, completedPickups, verifications, packaging, uncollected, orderTypes] = await Promise.all([
        prisma.order.findMany({
            where,
            select: {
                id: true, orderNumber: true, status: true, totalAmount: true, createdAt: true,
                takeawayVerification: { select: { usedAt: true, expiresAt: true } },
                payments: { select: { amount: true, method: true } },
                packagingItems: { select: { quantity: true, totalPrice: true, inventory: { select: { name: true, unit: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        prisma.order.count({ where }),
        prisma.order.aggregate({
            where: { ...where, status: { in: salesStatuses } },
            _sum: { totalAmount: true }
        }),
        prisma.order.count({ where: { ...where, status: { in: [OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI] } } }),
        prisma.order.count({ where: { ...where, status: OrderStatus.QISMAN_TOLANDI } }),
        prisma.takeawayVerification.count({ where: { order: where, usedAt: { not: null } } }),
        prisma.takeawayVerification.count({ where: { order: where } }),
        prisma.orderPackaging.aggregate({ where: { order: where }, _sum: { quantity: true, totalPrice: true } }),
        prisma.takeawayVerification.count({
            where: {
                order: { ...where, status: { in: [OrderStatus.TOLANDI, OrderStatus.YAKUNLANDI] } },
                usedAt: null
            }
        }),
        prisma.order.groupBy({
            by: ['orderType'],
            where: {
                ...orderWhere(compareFilters),
                status: { in: salesStatuses }
            },
            _sum: { totalAmount: true },
            _count: { id: true }
        })
    ]);
    return {
        count,
        paidCount,
        partiallyPaidCount,
        unpaidCount: Math.max(0, count - paidCount - partiallyPaidCount),
        revenue: money(totals._sum.totalAmount),
        completedPickups,
        uncollected,
        verificationEvents: verifications,
        orderTypes: orderTypes.map(row => ({ type: row.orderType, amount: money(row._sum.totalAmount), count: row._count.id })),
        packagingCost: money(packaging._sum.totalPrice),
        packagingQuantity: money(packaging._sum.quantity),
        orders: orders.map(order => ({
            id: order.id, orderNumber: order.orderNumber, status: order.status,
            amount: order.totalAmount.toString(), createdAt: order.createdAt.toISOString(),
            verifiedAt: order.takeawayVerification?.usedAt?.toISOString() || null,
            payments: money(order.payments.reduce((sum, payment) => sum.plus(payment.amount), zero)),
            packaging: order.packagingItems.map(item => ({ name: item.inventory.name, unit: item.inventory.unit, quantity: item.quantity.toString(), amount: item.totalPrice.toString() }))
        }))
    };
}

function safeAuditDetail(value: string | null): string | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        const redact = (entry: unknown): unknown => {
            if (Array.isArray(entry)) return entry.map(redact);
            if (!entry || typeof entry !== 'object') return typeof entry === 'string' ? entry.slice(0, 300) : entry;
            return Object.fromEntries(Object.entries(entry).map(([key, child]) => [
                key,
                /(password|secret|token|authorization|cookie|credential)/i.test(key) ? '[YASHIRILDI]' : redact(child)
            ]));
        };
        return JSON.stringify(redact(parsed)).slice(0, 1000);
    } catch {
        return 'Tafsilot mavjud';
    }
}

async function audit(filters: ReportFilters) {
    const userIds = [filters.waiterId, filters.cashierId].filter((id): id is string => Boolean(id));
    const userFilter = userIds.length ? { userId: { in: userIds } } : {};
    const [records, statusEvents] = await Promise.all([
        prisma.auditLog.findMany({
            where: { createdAt: { gte: filters.from, lte: filters.to }, ...userFilter },
            select: {
                id: true, action: true, entity: true, entityId: true, oldValue: true, newValue: true, createdAt: true,
                user: { select: { id: true, fullName: true, role: true, username: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 500
        }),
        prisma.orderStatusHistory.findMany({
            where: { createdAt: { gte: filters.from, lte: filters.to }, ...userFilter },
            select: {
                id: true, status: true, comment: true, user: { select: { id: true, fullName: true, role: true, username: true } },
                order: { select: { id: true, orderNumber: true } }, createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 500
        })
    ]);
    return [
        ...records.map(record => ({
            id: record.id,
            action: record.action,
            entity: record.entity,
            entityId: record.entityId,
            oldValue: safeAuditDetail(record.oldValue),
            newValue: safeAuditDetail(record.newValue),
            createdAt: record.createdAt.toISOString(),
            user: record.user
        })),
        ...statusEvents.map(event => ({
            id: event.id,
            action: `ORDER_STATUS_${event.status}`,
            entity: `Order #${event.order.orderNumber}`,
            entityId: event.order.id,
            oldValue: null,
            newValue: safeAuditDetail(event.comment ? JSON.stringify({ status: event.status, comment: event.comment }) : JSON.stringify({ status: event.status })),
            createdAt: event.createdAt.toISOString(),
            user: event.user
        }))
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
}

router.get('/filters', async (_req, res) => {
    try {
        const [waiters, cashiers, categories, dishes] = await Promise.all([
            prisma.user.findMany({ where: { role: RoleType.WAITER }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
            prisma.user.findMany({ where: { role: RoleType.CASHIER }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
            prisma.menuCategory.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
            prisma.menuItem.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 })
        ]);
        res.json({ success: true, data: { waiters, cashiers, categories, dishes, paymentMethods: Object.values(PaymentMethod), orderTypes: Object.values(OrderType) } });
    } catch (error) {
        console.error('Hisobot filtrlari yuklanmadi:', error);
        res.status(500).json({ success: false, message: 'Hisobot filtrlarini yuklab boвЂlmadi' });
    }
});

router.get('/:section', async (req, res) => {
    if (!validSections.has(req.params.section)) {
        res.status(404).json({ success: false, message: 'Hisobot boвЂlimi topilmadi' });
        return;
    }
    try {
        const filters = await readFilters(req.query);
        if (typeof filters === 'string') {
            res.status(400).json({ success: false, message: filters });
            return;
        }
        let data: unknown;
        switch (req.params.section) {
            case 'summary': data = await summary(filters); break;
            case 'foods': data = await foods(filters); break;
            case 'waiters': data = await waiters(filters); break;
            case 'cashiers': data = await cashiers(filters); break;
            case 'inventory': data = await inventory(filters); break;
            case 'expenses': data = await expenses(filters); break;
            case 'refunds': data = await refunds(filters); break;
            case 'orders': data = await ordersReport(filters); break;
            case 'customers': data = await customersReport(filters); break;
            case 'loyal-customers': data = await loyalCustomers(); break;
            case 'takeaway': data = await takeaway(filters); break;
            case 'audit': data = await audit(filters); break;
            case 'telegram':
                data = { implemented: false, message: 'Telegram hisobotlari va admin qabul qiluvchilari tizimda sozlanmagan.' };
                break;
            default: data = null;
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error(`Admin hisoboti tuzilmadi (${req.params.section}):`, error);
        res.status(500).json({ success: false, message: 'Hisobotni yuklashda xatolik yuz berdi' });
    }
});

export default router;
