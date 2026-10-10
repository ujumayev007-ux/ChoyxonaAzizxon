"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../utils/db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
const zero = new client_1.Prisma.Decimal(0);
const salesStatuses = [
    client_1.OrderStatus.QISMAN_TOLANDI,
    client_1.OrderStatus.TOLANDI,
    client_1.OrderStatus.YAKUNLANDI,
    client_1.OrderStatus.QAYTARILDI
];
const validSections = new Set([
    'summary', 'foods', 'waiters', 'cashiers', 'inventory', 'expenses',
    'refunds', 'orders', 'customers', 'loyal-customers', 'takeaway', 'audit', 'telegram'
]);
const money = (value) => (value || zero).toString();
function tashkentDayStart(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 5 * 60 * 60 * 1000);
}
function parseDate(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}
async function readFilters(query) {
    const from = query.from === undefined ? tashkentDayStart() : parseDate(query.from);
    const to = query.to === undefined ? new Date(tashkentDayStart().getTime() + 24 * 60 * 60 * 1000 - 1) : parseDate(query.to);
    if (!from || !to || from > to || to.getTime() - from.getTime() > 3660 * 24 * 60 * 60 * 1000) {
        return 'Hisobot sanalari notoвЂgвЂri yoki 10 yildan uzun';
    }
    const filters = { from, to };
    if (query.search !== undefined) {
        if (typeof query.search !== 'string' || query.search.length > 100)
            return 'Qidiruv matni notoвЂgвЂri';
        filters.search = query.search.trim();
    }
    const idFields = ['waiterId', 'cashierId', 'dishId', 'categoryId'];
    for (const field of idFields) {
        const value = query[field];
        if (value === undefined || value === '')
            continue;
        if (typeof value !== 'string' || value.length > 100)
            return 'Hisobot filtri notoвЂgвЂri';
        filters[field] = value;
    }
    if (filters.waiterId || filters.cashierId) {
        const [waiter, cashier] = await Promise.all([
            filters.waiterId
                ? db_1.prisma.user.findFirst({ where: { id: filters.waiterId, role: client_1.RoleType.WAITER }, select: { id: true } })
                : null,
            filters.cashierId
                ? db_1.prisma.user.findFirst({ where: { id: filters.cashierId, role: client_1.RoleType.CASHIER }, select: { id: true } })
                : null
        ]);
        if ((filters.waiterId && !waiter) || (filters.cashierId && !cashier)) {
            return 'Tanlangan xodim topilmadi';
        }
    }
    if (filters.dishId && !(await db_1.prisma.menuItem.findUnique({ where: { id: filters.dishId }, select: { id: true } }))) {
        return 'Tanlangan taom topilmadi';
    }
    if (filters.categoryId && !(await db_1.prisma.menuCategory.findUnique({ where: { id: filters.categoryId }, select: { id: true } }))) {
        return 'Tanlangan kategoriya topilmadi';
    }
    if (query.paymentMethod !== undefined) {
        if (typeof query.paymentMethod !== 'string' || !Object.values(client_1.PaymentMethod).includes(query.paymentMethod)) {
            return 'ToвЂlov turi notoвЂgвЂri';
        }
        filters.paymentMethod = query.paymentMethod;
    }
    if (query.orderType !== undefined) {
        if (typeof query.orderType !== 'string' || !Object.values(client_1.OrderType).includes(query.orderType)) {
            return 'Buyurtma turi notoвЂgвЂri';
        }
        filters.orderType = query.orderType;
    }
    return filters;
}
function orderAttributes(filters) {
    return {
        ...(filters.waiterId ? { waiterId: filters.waiterId } : {}),
        ...(filters.orderType ? { orderType: filters.orderType } : {}),
        ...(filters.dishId ? { items: { some: { menuItemId: filters.dishId } } } : {}),
        ...(filters.categoryId ? { items: { some: { menuItem: { categoryId: filters.categoryId } } } } : {})
    };
}
function orderWhere(filters) {
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
function salesWhere(filters) {
    return { ...orderWhere(filters), status: { in: salesStatuses } };
}
function paymentWhere(filters) {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        order: orderAttributes(filters)
    };
}
function debtPaymentWhere(filters) {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        debt: { order: orderAttributes(filters) }
    };
}
function expenseWhere(filters) {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {})
    };
}
function refundWhere(filters) {
    return {
        createdAt: { gte: filters.from, lte: filters.to },
        ...(filters.cashierId ? { cashierId: filters.cashierId } : {}),
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        order: orderAttributes(filters)
    };
}
function dateBucket(from, to) {
    const duration = to.getTime() - from.getTime();
    if (duration <= 2 * 24 * 60 * 60 * 1000)
        return 'hour';
    if (duration <= 60 * 24 * 60 * 60 * 1000)
        return 'day';
    if (duration <= 365 * 24 * 60 * 60 * 1000)
        return 'week';
    return 'month';
}
async function getSalesTrend(filters) {
    const conditions = [
        client_1.Prisma.sql `x."createdAt" >= ${filters.from}`,
        client_1.Prisma.sql `x."createdAt" <= ${filters.to}`
    ];
    if (filters.cashierId)
        conditions.push(client_1.Prisma.sql `x."cashierId" = ${filters.cashierId}`);
    if (filters.paymentMethod)
        conditions.push(client_1.Prisma.sql `x."method" = ${filters.paymentMethod}`);
    if (filters.waiterId)
        conditions.push(client_1.Prisma.sql `o."waiterId" = ${filters.waiterId}`);
    if (filters.orderType)
        conditions.push(client_1.Prisma.sql `o."orderType" = ${filters.orderType}::"OrderType"`);
    if (filters.dishId) {
        conditions.push(client_1.Prisma.sql `EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id" AND oi."menuItemId" = ${filters.dishId})`);
    }
    if (filters.categoryId) {
        conditions.push(client_1.Prisma.sql `EXISTS (
            SELECT 1 FROM "OrderItem" oi JOIN "MenuItem" mi ON mi."id" = oi."menuItemId"
            WHERE oi."orderId" = o."id" AND mi."categoryId" = ${filters.categoryId}
        )`);
    }
    const where = client_1.Prisma.join(conditions, ' AND ');
    const bucket = client_1.Prisma.raw(`'${dateBucket(filters.from, filters.to)}'`);
    return db_1.prisma.$queryRaw(client_1.Prisma.sql `
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
async function financialTrend(source, filters) {
    const bucket = client_1.Prisma.raw(`'${dateBucket(filters.from, filters.to)}'`);
    const conditions = [
        client_1.Prisma.sql `${client_1.Prisma.raw(source === 'expense' ? 'e' : 'r')}."createdAt" >= ${filters.from}`,
        client_1.Prisma.sql `${client_1.Prisma.raw(source === 'expense' ? 'e' : 'r')}."createdAt" <= ${filters.to}`
    ];
    const alias = client_1.Prisma.raw(source === 'expense' ? 'e' : 'r');
    if (filters.cashierId)
        conditions.push(client_1.Prisma.sql `${alias}."cashierId" = ${filters.cashierId}`);
    if (filters.paymentMethod)
        conditions.push(client_1.Prisma.sql `${alias}."method" = ${filters.paymentMethod}`);
    if (source === 'refund') {
        if (filters.waiterId)
            conditions.push(client_1.Prisma.sql `o."waiterId" = ${filters.waiterId}`);
        if (filters.orderType)
            conditions.push(client_1.Prisma.sql `o."orderType" = ${filters.orderType}::"OrderType"`);
        if (filters.dishId)
            conditions.push(client_1.Prisma.sql `EXISTS (SELECT 1 FROM "RefundItem" ri JOIN "OrderItem" oi ON oi."id" = ri."orderItemId" WHERE ri."refundId" = r."id" AND oi."menuItemId" = ${filters.dishId})`);
        if (filters.categoryId)
            conditions.push(client_1.Prisma.sql `EXISTS (
            SELECT 1 FROM "RefundItem" ri JOIN "OrderItem" oi ON oi."id" = ri."orderItemId"
            JOIN "MenuItem" mi ON mi."id" = oi."menuItemId"
            WHERE ri."refundId" = r."id" AND mi."categoryId" = ${filters.categoryId}
        )`);
    }
    const where = client_1.Prisma.join(conditions, ' AND ');
    const rows = source === 'expense'
        ? await db_1.prisma.$queryRaw(client_1.Prisma.sql `
            SELECT date_trunc(${bucket}, e."createdAt") AS bucket, SUM(e."amount") AS amount, COUNT(e."id")::int AS count
            FROM "Expense" e WHERE ${where}
            GROUP BY date_trunc(${bucket}, e."createdAt") ORDER BY bucket
        `)
        : await db_1.prisma.$queryRaw(client_1.Prisma.sql `
            SELECT date_trunc(${bucket}, r."createdAt") AS bucket, SUM(r."amount") AS amount, COUNT(r."id")::int AS count
            FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId" WHERE ${where}
            GROUP BY date_trunc(${bucket}, r."createdAt") ORDER BY bucket
        `);
    return rows.map(row => ({ date: row.bucket.toISOString(), amount: money(row.amount), count: row.count }));
}
async function menuAggregates(filters) {
    const itemWhere = {
        order: salesWhere(filters),
        ...(filters.dishId ? { menuItemId: filters.dishId } : {}),
        ...(filters.categoryId ? { menuItem: { categoryId: filters.categoryId } } : {})
    };
    const [groups, refundedItems] = await Promise.all([db_1.prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: itemWhere,
            _sum: { quantity: true, totalPrice: true },
            orderBy: { _sum: { totalPrice: 'desc' } }
        }), db_1.prisma.refundItem.groupBy({
            by: ['orderItemId'],
            where: { refund: refundWhere(filters) },
            _sum: { quantity: true, amount: true }
        })]);
    const refundedOrderItems = refundedItems.length
        ? await db_1.prisma.orderItem.findMany({
            where: { id: { in: refundedItems.map(item => item.orderItemId) } },
            select: { id: true, menuItemId: true }
        })
        : [];
    const itemToMenuId = new Map(refundedOrderItems.map(item => [item.id, item.menuItemId]));
    const refundedByMenu = new Map();
    for (const item of refundedItems) {
        const menuItemId = itemToMenuId.get(item.orderItemId);
        if (!menuItemId)
            continue;
        const value = refundedByMenu.get(menuItemId) || { quantity: zero, revenue: zero };
        value.quantity = value.quantity.plus(item._sum.quantity || zero);
        value.revenue = value.revenue.plus(item._sum.amount || zero);
        refundedByMenu.set(menuItemId, value);
    }
    const menuItems = await db_1.prisma.menuItem.findMany({
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
    }).filter(item => new client_1.Prisma.Decimal(item.quantity).greaterThan(0) || new client_1.Prisma.Decimal(item.revenue).greaterThan(0));
    return items;
}
async function summary(filters) {
    const orders = orderWhere(filters);
    const [orderTotals, orderCounts, debt, debtPayments, expenses, refunds, trend, menu, stock, waiterGroups, loyalGroups, paymentGroups, debtPaymentGroups, paymentHistory, debtPaymentHistory] = await Promise.all([
        db_1.prisma.order.aggregate({
            where: salesWhere(filters),
            _sum: { totalAmount: true },
            _count: { id: true }
        }),
        db_1.prisma.order.count({ where: orders }),
        db_1.prisma.customerDebt.aggregate({
            where: {
                createdAt: { gte: filters.from, lte: filters.to },
                ...(filters.cashierId ? { createdById: filters.cashierId } : {}),
                order: orderAttributes(filters)
            },
            _sum: { amount: true }
        }),
        db_1.prisma.debtPayment.aggregate({ where: debtPaymentWhere(filters), _sum: { amount: true } }),
        db_1.prisma.expense.aggregate({ where: expenseWhere(filters), _sum: { amount: true } }),
        db_1.prisma.refund.aggregate({ where: refundWhere(filters), _sum: { amount: true }, _count: { id: true } }),
        getSalesTrend(filters),
        menuAggregates(filters),
        db_1.prisma.inventoryProduct.findMany({
            where: {},
            select: { id: true, quantity: true, minQuantity: true }
        }),
        db_1.prisma.order.groupBy({
            by: ['waiterId'],
            where: { ...salesWhere(filters), waiterId: { not: null } },
            _sum: { totalAmount: true },
            _count: { id: true },
            orderBy: { _sum: { totalAmount: 'desc' } },
            take: 1
        }),
        db_1.prisma.order.groupBy({
            by: ['customerId'],
            where: { customerId: { not: null }, status: { in: salesStatuses } },
            _count: { id: true }
        }),
        db_1.prisma.payment.groupBy({ by: ['method'], where: paymentWhere(filters), _sum: { amount: true } }),
        db_1.prisma.debtPayment.groupBy({ by: ['method'], where: debtPaymentWhere(filters), _sum: { amount: true } }),
        db_1.prisma.payment.findMany({
            where: paymentWhere(filters),
            select: {
                id: true, amount: true, method: true, createdAt: true,
                cashier: { select: { fullName: true } },
                order: { select: { orderNumber: true, orderType: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        db_1.prisma.debtPayment.findMany({
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
    const orderTypes = await db_1.prisma.order.groupBy({
        by: ['orderType'],
        where: salesWhere(filters),
        _sum: { totalAmount: true },
        _count: { id: true }
    });
    const waiter = waiterGroups[0]?.waiterId
        ? await db_1.prisma.user.findUnique({ where: { id: waiterGroups[0].waiterId }, select: { fullName: true } })
        : null;
    const topDish = [...menu].sort((left, right) => new client_1.Prisma.Decimal(right.quantity).comparedTo(left.quantity))[0];
    const paymentTotals = Object.fromEntries(Object.values(client_1.PaymentMethod).map(method => [
        method,
        money(paymentGroups.find(payment => payment.method === method)?._sum.amount)
    ]));
    const collectedByMethod = Object.fromEntries(Object.values(client_1.PaymentMethod).map(method => [
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
        .sort((left, right) => new client_1.Prisma.Decimal(right[1]).comparedTo(left[1]))[0];
    return {
        kpis: {
            grossSales: money(gross),
            netReceipts: money(gross.minus(refundAmount)),
            orders: orderCounts,
            averageCheck: money(averageOrderAmount),
            payments: Object.fromEntries(Object.values(client_1.PaymentMethod).map(method => [method, money(collectedByMethod[method])])),
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
            topPayment: topPayment && new client_1.Prisma.Decimal(topPayment[1]).greaterThan(0) ? topPayment : null,
            lowStockCount: stock.filter(product => product.quantity.lessThanOrEqualTo(product.minQuantity)).length,
            loyalCustomers: loyalGroups.filter(group => group._count.id >= 5).length,
            refunds: money(refundAmount),
            expenses: money(expenses._sum.amount)
        }
    };
}
async function foods(filters) {
    const items = await menuAggregates(filters);
    const total = items.reduce((sum, item) => sum.plus(item.revenue), zero);
    const categories = new Map();
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
    const byQuantity = [...items].sort((a, b) => new client_1.Prisma.Decimal(b.quantity).comparedTo(a.quantity));
    return {
        items,
        topQuantity: byQuantity.slice(0, 10),
        topRevenue: [...items].sort((a, b) => new client_1.Prisma.Decimal(b.revenue).comparedTo(a.revenue)).slice(0, 10),
        leastSold: byQuantity.slice(-10).reverse(),
        categories: [...categories.values()].map(category => ({
            ...category,
            quantity: category.quantity.toString(),
            revenue: category.revenue.toString(),
            share: total.isZero() ? '0' : category.revenue.dividedBy(total).times(100).toFixed(2)
        }))
    };
}
async function waiters(filters) {
    const users = await db_1.prisma.user.findMany({
        where: { role: client_1.RoleType.WAITER, ...(filters.waiterId ? { id: filters.waiterId } : {}) },
        select: { id: true, username: true, fullName: true, waiterProfile: { select: { commissionPercent: true } } },
        orderBy: { fullName: 'asc' }
    });
    const groups = await db_1.prisma.order.groupBy({
        by: ['waiterId'],
        where: { ...salesWhere(filters), waiterId: { not: null } },
        _sum: { totalAmount: true },
        _count: { id: true }
    });
    const userIds = users.map(user => user.id);
    const cancelled = await db_1.prisma.orderStatusHistory.groupBy({
        by: ['userId'],
        where: {
            userId: { in: userIds },
            createdAt: { gte: filters.from, lte: filters.to },
            status: client_1.OrderStatus.BEKOR_QILINDI
        },
        _count: { id: true }
    });
    const refundGroups = await db_1.prisma.refund.groupBy({
        by: ['orderId'],
        where: refundWhere(filters),
        _sum: { amount: true }
    });
    const refundedOrders = refundGroups.length
        ? await db_1.prisma.order.findMany({
            where: { id: { in: refundGroups.map(group => group.orderId) } },
            select: { id: true, waiterId: true }
        })
        : [];
    const eligibleOrders = await db_1.prisma.order.findMany({
        where: { ...salesWhere(filters), waiterId: { in: userIds } },
        select: {
            waiterId: true,
            payments: { select: { amount: true } },
            debt: { select: { payments: { select: { amount: true } } } },
            refunds: { select: { amount: true } }
        }
    });
    const collectedByWaiter = new Map();
    for (const order of eligibleOrders) {
        if (!order.waiterId)
            continue;
        const paid = order.payments.reduce((sum, payment) => sum.plus(payment.amount), zero)
            .plus(order.debt?.payments.reduce((sum, payment) => sum.plus(payment.amount), zero) || zero);
        const refunded = order.refunds.reduce((sum, refund) => sum.plus(refund.amount), zero);
        const netCollected = client_1.Prisma.Decimal.max(paid.minus(refunded), zero);
        collectedByWaiter.set(order.waiterId, (collectedByWaiter.get(order.waiterId) || zero).plus(netCollected));
    }
    return users.map(user => {
        const group = groups.find(item => item.waiterId === user.id);
        const refundAmount = refundedOrders.reduce((sum, order) => {
            if (order.waiterId !== user.id)
                return sum;
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
async function cashiers(filters) {
    const users = await db_1.prisma.user.findMany({
        where: { role: client_1.RoleType.CASHIER, ...(filters.cashierId ? { id: filters.cashierId } : {}) },
        select: { id: true, username: true, fullName: true },
        orderBy: { fullName: 'asc' }
    });
    const userIds = users.map(user => user.id);
    const sessions = await db_1.prisma.cashSession.findMany({
        where: { cashierId: { in: userIds }, openedAt: { lte: filters.to }, OR: [{ closedAt: null }, { closedAt: { gte: filters.from } }] },
        select: {
            id: true, cashierId: true, startingBalance: true, expectedCash: true, actualCash: true,
            difference: true, openedAt: true, closedAt: true
        },
        orderBy: { openedAt: 'desc' },
        take: 500
    });
    const [paymentGroups, expenseGroups, refundGroups, debtGroups, collectedDebtGroups, bookedGroups] = await Promise.all([
        db_1.prisma.payment.groupBy({
            by: ['cashierId', 'method'],
            where: paymentWhere(filters),
            _sum: { amount: true }
        }),
        db_1.prisma.expense.groupBy({ by: ['cashierId'], where: expenseWhere(filters), _sum: { amount: true } }),
        db_1.prisma.refund.groupBy({ by: ['cashierId'], where: refundWhere(filters), _sum: { amount: true } }),
        db_1.prisma.customerDebt.groupBy({
            by: ['createdById'],
            where: {
                createdAt: { gte: filters.from, lte: filters.to },
                ...(filters.cashierId ? { createdById: filters.cashierId } : {}),
                order: orderAttributes(filters)
            },
            _sum: { amount: true }
        }),
        db_1.prisma.debtPayment.groupBy({ by: ['cashierId', 'method'], where: debtPaymentWhere(filters), _sum: { amount: true } }),
        db_1.prisma.order.groupBy({
            by: ['createdById'],
            where: { ...salesWhere(filters), createdById: { in: userIds } },
            _sum: { totalAmount: true }
        })
    ]);
    return users.map(user => {
        const shifts = sessions.filter(session => session.cashierId === user.id);
        const collectedByMethod = (method) => (paymentGroups.find(group => group.cashierId === user.id && group.method === method)?._sum.amount || zero)
            .plus(collectedDebtGroups.find(group => group.cashierId === user.id && group.method === method)?._sum.amount || zero);
        const payments = {
            [client_1.PaymentMethod.NAQD]: money(collectedByMethod(client_1.PaymentMethod.NAQD)),
            [client_1.PaymentMethod.PLASTIK]: money(collectedByMethod(client_1.PaymentMethod.PLASTIK)),
            [client_1.PaymentMethod.ELEKTRON]: money(collectedByMethod(client_1.PaymentMethod.ELEKTRON)),
            [client_1.PaymentMethod.QARZ]: '0'
        };
        return {
            id: user.id,
            name: user.fullName,
            login: user.username,
            payments,
            sales: money(bookedGroups.find(group => group.createdById === user.id)?._sum.totalAmount),
            receipts: money(collectedByMethod(client_1.PaymentMethod.NAQD).plus(collectedByMethod(client_1.PaymentMethod.PLASTIK)).plus(collectedByMethod(client_1.PaymentMethod.ELEKTRON))),
            debtIssued: money(debtGroups.find(group => group.createdById === user.id)?._sum.amount),
            expenses: money(expenseGroups.find(group => group.cashierId === user.id)?._sum.amount),
            refunds: money(refundGroups.find(group => group.cashierId === user.id)?._sum.amount),
            debtCollected: money(collectedDebtGroups.find(group => group.cashierId === user.id)?._sum.amount),
            sessions: shifts.map(session => ({
                id: session.id,
                openedAt: session.openedAt.toISOString(),
                closedAt: session.closedAt?.toISOString() || null,
                durationMinutes: Math.max(0, Math.round((Math.min((session.closedAt || filters.to).getTime(), filters.to.getTime()) -
                    Math.max(session.openedAt.getTime(), filters.from.getTime())) / 60000)),
                openingCash: money(session.startingBalance),
                expectedCash: money(session.expectedCash),
                actualCash: money(session.actualCash),
                difference: money(session.difference)
            }))
        };
    });
}
async function inventory(filters) {
    const products = await db_1.prisma.inventoryProduct.findMany({
        where: {},
        select: { id: true, name: true, unit: true, quantity: true, minQuantity: true },
        orderBy: { name: 'asc' }
    });
    const [movementGroups, movementRecords, purchaseTotals] = await Promise.all([
        db_1.prisma.inventoryTransaction.groupBy({
            by: ['inventoryId', 'type'],
            where: { createdAt: { gte: filters.from, lte: filters.to } },
            _sum: { quantityChange: true }
        }),
        db_1.prisma.inventoryTransaction.findMany({
            where: { createdAt: { gte: filters.from, lte: filters.to } },
            select: { inventoryId: true, type: true, quantityChange: true, createdAt: true, inventory: { select: { name: true, unit: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        db_1.prisma.purchaseItem.groupBy({
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
async function expenses(filters) {
    const where = expenseWhere(filters);
    const [groups, records, totals, trend] = await Promise.all([
        db_1.prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: { id: true }, orderBy: { _sum: { amount: 'desc' } } }),
        db_1.prisma.expense.findMany({
            where,
            select: { id: true, amount: true, category: true, description: true, method: true, createdAt: true, cashier: { select: { id: true, fullName: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        }),
        db_1.prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
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
async function refunds(filters) {
    const where = refundWhere(filters);
    const [records, totals, reasons, trend] = await Promise.all([
        db_1.prisma.refund.findMany({
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
        db_1.prisma.refund.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
        db_1.prisma.refund.groupBy({ by: ['reason'], where, _sum: { amount: true }, _count: { id: true } }),
        financialTrend('refund', filters)
    ]);
    const itemIds = [...new Set(records.flatMap(record => record.items.map(item => item.orderItemId)))];
    const orderItems = await db_1.prisma.orderItem.findMany({
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
async function ordersReport(filters) {
    const where = orderWhere(filters);
    const [groups, total, records] = await Promise.all([
        db_1.prisma.order.groupBy({ by: ['status', 'orderType'], where, _count: { id: true }, _sum: { totalAmount: true } }),
        db_1.prisma.order.count({ where }),
        db_1.prisma.order.findMany({
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
async function customerMetrics(filters, includeHistory = false) {
    const where = includeHistory ? {} : orderWhere(filters);
    const groups = await db_1.prisma.order.groupBy({
        by: ['customerId'],
        where: { ...where, customerId: { not: null }, status: { in: salesStatuses } },
        _sum: { totalAmount: true },
        _count: { id: true },
        _max: { createdAt: true }
    });
    const debtGroups = await db_1.prisma.customerDebt.groupBy({
        by: ['customerId'],
        where: { remaining: { gt: 0 } },
        _sum: { remaining: true }
    });
    const searchedIds = filters.search
        ? (await db_1.prisma.customer.findMany({
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
        .filter(group => !searchedIds || searchedIds.includes(group.customerId))
        .sort((a, b) => (b._sum.totalAmount || zero).comparedTo(a._sum.totalAmount || zero))
        .slice(0, 500)
        .map(group => group.customerId);
    const customers = await db_1.prisma.customer.findMany({
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
        const customer = byId.get(group.customerId);
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
async function customersReport(filters) {
    const [rows, total, newCustomers, orderTotals] = await Promise.all([
        customerMetrics(filters),
        db_1.prisma.customer.count(),
        db_1.prisma.customer.count({ where: { createdAt: { gte: filters.from, lte: filters.to } } }),
        db_1.prisma.order.aggregate({
            where: { ...salesWhere(filters), customerId: { not: null } },
            _sum: { totalAmount: true },
            _avg: { totalAmount: true }
        })
    ]);
    const allCustomersWithOrders = await db_1.prisma.order.groupBy({
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
    const allTime = { from: new Date(0), to: new Date() };
    const rows = await customerMetrics(allTime, true);
    const now = Date.now();
    const ranked = rows.map(row => {
        const recencyDays = row.lastVisit ? Math.floor((now - new Date(row.lastVisit).getTime()) / 86400000) : Number.MAX_SAFE_INTEGER;
        const spend = new client_1.Prisma.Decimal(row.purchases);
        const averageCheck = new client_1.Prisma.Decimal(row.averageCheck);
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
        topCustomers: ranked.sort((a, b) => new client_1.Prisma.Decimal(b.purchases).comparedTo(a.purchases)).slice(0, 100)
    };
}
async function takeaway(filters) {
    const where = { ...orderWhere(filters), orderType: client_1.OrderType.TAKEAWAY };
    const compareFilters = { ...filters, orderType: undefined };
    const [orders, count, totals, paidCount, partiallyPaidCount, completedPickups, verifications, packaging, uncollected, orderTypes] = await Promise.all([
        db_1.prisma.order.findMany({
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
        db_1.prisma.order.count({ where }),
        db_1.prisma.order.aggregate({
            where: { ...where, status: { in: salesStatuses } },
            _sum: { totalAmount: true }
        }),
        db_1.prisma.order.count({ where: { ...where, status: { in: [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI] } } }),
        db_1.prisma.order.count({ where: { ...where, status: client_1.OrderStatus.QISMAN_TOLANDI } }),
        db_1.prisma.takeawayVerification.count({ where: { order: where, usedAt: { not: null } } }),
        db_1.prisma.takeawayVerification.count({ where: { order: where } }),
        db_1.prisma.orderPackaging.aggregate({ where: { order: where }, _sum: { quantity: true, totalPrice: true } }),
        db_1.prisma.takeawayVerification.count({
            where: {
                order: { ...where, status: { in: [client_1.OrderStatus.TOLANDI, client_1.OrderStatus.YAKUNLANDI] } },
                usedAt: null
            }
        }),
        db_1.prisma.order.groupBy({
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
function safeAuditDetail(value) {
    if (!value)
        return null;
    try {
        const parsed = JSON.parse(value);
        const redact = (entry) => {
            if (Array.isArray(entry))
                return entry.map(redact);
            if (!entry || typeof entry !== 'object')
                return typeof entry === 'string' ? entry.slice(0, 300) : entry;
            return Object.fromEntries(Object.entries(entry).map(([key, child]) => [
                key,
                /(password|secret|token|authorization|cookie|credential)/i.test(key) ? '[YASHIRILDI]' : redact(child)
            ]));
        };
        return JSON.stringify(redact(parsed)).slice(0, 1000);
    }
    catch {
        return 'Tafsilot mavjud';
    }
}
async function audit(filters) {
    const userIds = [filters.waiterId, filters.cashierId].filter((id) => Boolean(id));
    const userFilter = userIds.length ? { userId: { in: userIds } } : {};
    const [records, statusEvents] = await Promise.all([
        db_1.prisma.auditLog.findMany({
            where: { createdAt: { gte: filters.from, lte: filters.to }, ...userFilter },
            select: {
                id: true, action: true, entity: true, entityId: true, oldValue: true, newValue: true, createdAt: true,
                user: { select: { id: true, fullName: true, role: true, username: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 500
        }),
        db_1.prisma.orderStatusHistory.findMany({
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
            db_1.prisma.user.findMany({ where: { role: client_1.RoleType.WAITER }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
            db_1.prisma.user.findMany({ where: { role: client_1.RoleType.CASHIER }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
            db_1.prisma.menuCategory.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
            db_1.prisma.menuItem.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 })
        ]);
        res.json({ success: true, data: { waiters, cashiers, categories, dishes, paymentMethods: Object.values(client_1.PaymentMethod), orderTypes: Object.values(client_1.OrderType) } });
    }
    catch (error) {
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
        let data;
        switch (req.params.section) {
            case 'summary':
                data = await summary(filters);
                break;
            case 'foods':
                data = await foods(filters);
                break;
            case 'waiters':
                data = await waiters(filters);
                break;
            case 'cashiers':
                data = await cashiers(filters);
                break;
            case 'inventory':
                data = await inventory(filters);
                break;
            case 'expenses':
                data = await expenses(filters);
                break;
            case 'refunds':
                data = await refunds(filters);
                break;
            case 'orders':
                data = await ordersReport(filters);
                break;
            case 'customers':
                data = await customersReport(filters);
                break;
            case 'loyal-customers':
                data = await loyalCustomers();
                break;
            case 'takeaway':
                data = await takeaway(filters);
                break;
            case 'audit':
                data = await audit(filters);
                break;
            case 'telegram':
                data = { implemented: false, message: 'Telegram hisobotlari va admin qabul qiluvchilari tizimda sozlanmagan.' };
                break;
            default: data = null;
        }
        res.json({ success: true, data });
    }
    catch (error) {
        console.error(`Admin hisoboti tuzilmadi (${req.params.section}):`, error);
        res.status(500).json({ success: false, message: 'Hisobotni yuklashda xatolik yuz berdi' });
    }
});
exports.default = router;
