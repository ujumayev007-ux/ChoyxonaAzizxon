import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { Prisma, OrderStatus } from '@prisma/client';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { emitSocketEvent } from '../socket';
import { getSettings } from '../utils/settings';
import { queueKitchenPrint } from '../utils/kitchen-print';
import { authorizeService, servicePolicy, assertEditable, assertOrderFresh, aggregateItemStatus, closedServiceStatuses, ServiceError, fail } from '../utils/service-policy';
import { decimalSum, orderBalance, refundServiceLine } from '../utils/service-finance';
import { lockTransaction } from '../utils/advisory-lock';
import { withOrderReturnDetails } from '../utils/order-returns';
import { queueKitchenReturnPrint } from '../utils/kitchen-print';

const router = Router();
router.use(authenticateToken, requireRole(['WAITER', 'CASHIER', 'KITCHEN', 'ADMIN']));
export const serviceLegacyRouter = Router();
const includeOrder = {
    table: { include: { room: true, assignedWaiter: { select: { id: true, fullName: true } } } },
    waiter: { select: { id: true, fullName: true } }, processingBy: { select: { id: true, fullName: true } },
    items: { include: { menuItem: { select: { id: true, name: true, unit: true, sellingPrice: true, available: true, unavailableReason: true, kitchenSection: true, category: { select: { id: true, name: true } } } } } }, payments: true, refunds: { include: { items: true } }, debt: { include: { payments: true } },
    serviceRequests: { include: { requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } } }
} satisfies Prisma.OrderInclude;
const pendingStatuses = ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'];
serviceLegacyRouter.post('/tables/:tableId/pay', authenticateToken, requireRole(['WAITER', 'CASHIER', 'ADMIN']), async (req, res, next) => {
    try { await authorizeService(prisma, req.user!, 'takePayment'); next(); }
    catch (error) { res.status(error instanceof ServiceError ? error.status : 503).json({ success: false, message: error instanceof Error ? error.message : 'Ruxsat tekshirilmadi' }); }
});
const wrap = (handler: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
    try { await handler(req, res); } catch (error) {
        if (!(error instanceof ServiceError)) console.error('Xizmat amali:', error);
        const conflict = ['P2002', 'P2034'].includes((error as any)?.code);
        res.status(error instanceof ServiceError ? error.status : conflict ? 409 : 503).json({ success: false,
            message: error instanceof ServiceError ? error.message : conflict ? 'Ma’lumot yangilandi. Xuddi shu so‘rovni qayta tekshiring.' : 'Natijani qayta tekshirish kerak. Shu so‘rov bilan qayta urinib ko‘ring.' });
    }
};
const stringValue = (value: any, max = 500) => typeof value === 'string' && value.length <= max ? value.trim() : '';
const qty = (value: any) => {
    if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(String(value)) || Number(value) <= 0) fail(400, 'Miqdorni to‘g‘ri kiriting');
    return new Prisma.Decimal(String(value));
};
function changed(data: any) {
    emitSocketEvent('orderUpdate', data); emitSocketEvent('order_status_updated', data);
    emitSocketEvent('table_status_updated', data); emitSocketEvent('service_updated', data);
}
async function audit(tx: Prisma.TransactionClient, userId: string, order: any, action: string, detail: any) {
    await tx.auditLog.create({ data: { userId, action, entity: 'Order', entityId: order.id, newValue: JSON.stringify(detail) } });
    const labels = { ORDER_CREATED: 'Buyurtma yaratildi', ORDER_APPROVED: 'Buyurtma tasdiqlandi va ofitsant biriktirildi', ORDER_REJECTED: 'Buyurtma rad etildi', ORDER_ASSIGNED: 'Ofitsant buyurtmani oldi', ITEM_STATUS_CHANGED: 'Taom holati yangilandi', KITCHEN_NOTE_READ: 'Oshxona izohni ko‘rdi', SERVICE_NOTE_ADDED: 'Yangi izoh', WAITER_RETURN_REQUESTED: 'Qaytarish so‘rovi yuborildi', WAITER_CANCEL_REQUESTED: 'Bekor qilish so‘rovi yuborildi', SERVICE_REQUEST_DECIDED: 'So‘rovga qaror berildi', ORDER_TRANSFERRED: 'Buyurtma ko‘chirildi / topshirildi', SHIFT_HANDOVER: 'Smena topshirildi' };
    const statuses = { TAYYORLANMOQDA: 'tayyorlanmoqda', TAYYOR: 'tayyor', OLIB_KETILDI: 'olib ketildi', STOLGA_YETKAZILDI: 'stolga yetkazildi', TASDIQLANDI: 'tasdiqlandi', RAD_ETILDI: 'rad etildi' };
    const comment = [labels[action] || action, detail.name, statuses[detail.status], detail.note, detail.decisionReason || detail.reason,
        detail.quantity ? `${detail.quantity} miqdor` : '', detail.amount ? `${detail.amount} so‘m` : ''].filter(Boolean).join(' · ');
    await tx.orderStatusHistory.create({ data: { orderId: order.id, userId, status: order.status as OrderStatus, comment } });
}
async function lockOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id }, include: includeOrder });
    if (!order) fail(404, 'Buyurtma topilmadi');
    return order!;
}
async function lockWaiters(tx: Prisma.TransactionClient, ids: string[]) {
    for (const id of [...new Set(ids.filter(Boolean))].sort()) await lockTransaction(tx, 'waiter:' + id);
}
// Advisory key lock serializes even the first create, before an Order row exists.
export async function serviceMutation(req: Request, operation: string, work: (tx: Prisma.TransactionClient) => Promise<any>) {
    if (req.body?.actorId !== undefined && req.body.actorId !== req.user!.id) fail(401, 'Sessiya o‘zgargan. Panelni qayta yuklang');
    const key = req.body?.idempotencyKey;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail(400, 'So‘rov identifikatori kerak');
    const hash = createHash('sha256').update(JSON.stringify({ path: req.path, body: req.body })).digest('hex');
    return prisma.$transaction(async tx => {
        await lockTransaction(tx, key);
        const previous = await tx.idempotencyRecord.findUnique({ where: { key } });
        if (previous) {
            if (previous.userId !== req.user!.id || previous.operation !== operation || previous.requestHash !== hash) fail(409, 'Bu identifikator boshqa so‘rovga tegishli');
            return JSON.parse(previous.responseJson);
        }
        const result = await work(tx);
        await tx.idempotencyRecord.create({ data: { key, userId: req.user!.id, operation, requestHash: hash, resourceId: result?.id || null, responseJson: JSON.stringify(result) } });
        return result;
    }, { maxWait: 10000, timeout: 30000 });
}
async function scopeWhere(user: any, db: Prisma.TransactionClient = prisma) {
    const policy = await servicePolicy(db);
    return user.role === 'WAITER' && policy.scope === 'OWN' ? { OR: [{ waiterId: user.id }, { waiterId: null, table: { assignedWaiterId: user.id } }, { waiterId: null, table: { assignedWaiterId: null } }] } : {};
}
function callRights(call: any, user: any, policy: any) {
    if (user.role === 'ADMIN') return;
    if (call.kind === 'CASHIER_ASSIST' && user.role !== 'CASHIER') fail(403, 'Bu chaqiruvni kassir qabul qiladi');
    if (call.kind === 'CUSTOMER' && user.role !== 'WAITER') fail(403, 'Bu chaqiruvni ofitsant qabul qiladi');
    if (call.kind === 'CUSTOMER' && policy.scope === 'OWN' && call.table.assignedWaiterId && call.table.assignedWaiterId !== user.id) fail(403, 'Bu stol boshqa ofitsantga tegishli');
}

router.get('/config', wrap(async (req, res) => res.json({ success: true, data: await servicePolicy(prisma), user: req.user })));
router.get('/operations/:key', wrap(async (req, res) => {
    const row = await prisma.idempotencyRecord.findUnique({ where: { key: req.params.key } });
    if (row && row.userId !== req.user!.id) fail(403, 'So‘rov boshqa xodimga tegishli');
    res.json({ success: true, data: row ? JSON.parse(row.responseJson) : null });
}));
router.get('/staff', wrap(async (_req, res) => res.json({ success: true, data: await prisma.user.findMany({ where: { role: 'WAITER', isActive: true }, select: { id: true, fullName: true } }) })));
router.get('/orders', wrap(async (req, res) => {
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1)), take = 30;
    const where: any = { AND: [await scopeWhere(req.user), { archivedAt: null }] };
    if (req.query.status && !Object.values(OrderStatus).includes(req.query.status as OrderStatus)) fail(400, 'Buyurtma holati noto‘g‘ri');
    if (req.query.history === 'true') where.AND.push({ waiterId: req.user!.role === 'WAITER' ? req.user!.id : undefined, status: { in: closedServiceStatuses } });
    else where.AND.push({ status: { notIn: closedServiceStatuses } });
    for (const field of ['tableId', 'waiterId', 'status'] as const) if (req.query[field]) where.AND.push({ [field]: String(req.query[field]) });
    if (req.query.roomId) where.AND.push({ table: { roomId: String(req.query.roomId) } });
    if (req.query.search) where.AND.push({ orderNumber: { contains: stringValue(req.query.search, 80), mode: 'insensitive' } });
    const dates: any = {};
    for (const [param, op] of [['from', 'gte'], ['to', 'lt']]) if (req.query[param]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[param]))) fail(400, 'Sana noto‘g‘ri');
        const date = new Date(`${req.query[param]}T00:00:00+05:00`);
        if (!Number.isFinite(date.getTime())) fail(400, 'Sana noto‘g‘ri');
        dates[op] = op === 'lt' ? new Date(date.getTime() + 86400000) : date;
    }
    if (Object.keys(dates).length) where.AND.push({ createdAt: dates });
    const [orders, count] = await prisma.$transaction([prisma.order.findMany({ where, include: includeOrder, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }), prisma.order.count({ where })]);
    res.json({ success: true, data: orders.map(order => ({ ...withOrderReturnDetails(order), balance: orderBalance(order) })), page, pages: Math.ceil(count / take), count });
}));
router.get('/orders/:id', wrap(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { ...includeOrder, statusHistory: { include: { user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } } } });
    if (!order) fail(404, 'Buyurtma topilmadi');
    await authorizeService(prisma, req.user!, 'read', order);
    if (req.user!.role === 'WAITER' && closedServiceStatuses.includes(order!.status) && order!.waiterId !== req.user!.id) fail(403, 'Bu tarix boshqa ofitsantga tegishli');
    res.json({ success: true, data: { ...withOrderReturnDetails(order), balance: orderBalance(order) } });
}));
router.get('/tables/:id/bill', wrap(async (req, res) => {
    const table = await prisma.table.findUnique({ where: { id: req.params.id }, include: { assignedWaiter: { select: { id: true, fullName: true } } } });
    if (!table) fail(404, 'Stol topilmadi');
    await authorizeService(prisma, req.user!, 'read', { table, waiterId: table!.assignedWaiterId });
    const orders = await prisma.order.findMany({ where: { tableId: table!.id, status: { notIn: closedServiceStatuses } }, include: includeOrder, orderBy: { createdAt: 'asc' } });
    const balances = orders.map(orderBalance);
    const totals: any = {};
    for (const key of ['total', 'paid', 'refunds', 'debt', 'debtRemaining', 'remaining']) totals[key] = decimalSum(balances.map(b => b[key]));
    totals.subtotal = decimalSum(orders.map(o => o.subtotal)); totals.serviceCharge = decimalSum(orders.map(o => o.serviceCharge)); totals.discount = decimalSum(orders.map(o => o.discount));
    const calls = await prisma.waiterCall.findMany({ where: { tableId: table!.id, kind: 'CASHIER_ASSIST' }, include: { acceptedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 5 });
    res.json({ success: true, data: { table, orders: orders.map(withOrderReturnDetails), totals, guests: orders.reduce((sum, o) => sum + o.guestCount, 0), calls } });
}));

const createOrder = wrap(async (req, res) => {
    const { tableId, items, guestCount, note } = req.body || {};
    if (!stringValue(tableId, 100) || !Array.isArray(items) || !items.length || items.length > 100 || !Number.isInteger(Number(guestCount)) || Number(guestCount) < 1 || Number(guestCount) > 999 || (note != null && (typeof note !== 'string' || note.length > 500))) fail(400, 'Stol, mehmonlar yoki taomlar noto‘g‘ri');
    const result = await serviceMutation(req, 'WAITER_CREATE', async tx => {
        await authorizeService(tx, req.user!, 'assign');
        await lockWaiters(tx, [req.user!.id]);
        await tx.$queryRaw`SELECT "id" FROM "Table" WHERE "id" = ${tableId} FOR UPDATE`;
        const table = await tx.table.findFirst({ where: { id: tableId, isActive: true, room: { isActive: true } } });
        if (!table) fail(404, 'Faol stol topilmadi');
        await authorizeService(tx, req.user!, 'read', { table, waiterId: table!.assignedWaiterId });
        const products = await tx.menuItem.findMany({ where: { id: { in: items.map(i => String(i.productId || i.menuItemId)) }, isActive: true, available: true, category: { isActive: true } } });
        const lines = items.map(i => {
            const product = products.find(p => p.id === (i.productId || i.menuItemId));
            if (!product) fail(409, 'Taom sotuvda yo‘q. Menyuni yangilang');
            if (i.note != null && (typeof i.note !== 'string' || i.note.length > 500)) fail(400, 'Taom izohi noto‘g‘ri');
            const quantity = qty(i.quantity);
            return { menuItemId: product!.id, quantity, unitPrice: product!.sellingPrice, totalPrice: product!.sellingPrice.mul(quantity).toDecimalPlaces(2), notes: stringValue(i.note) || null };
        });
        const rules = await getSettings(tx, 'orders'), restaurant = await getSettings(tx, 'restaurant');
        const subtotal = decimalSum(lines.map(i => i.totalPrice));
        const serviceCharge = subtotal.mul(restaurant.serviceFeePercent).div(100).toDecimalPlaces(2);
        const status = rules.autoApprove ? 'TASDIQLANDI' : 'YANGI';
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()).replace(/-/g, '');
        const order = await tx.order.create({ data: { orderNumber: `${date}-${randomBytes(6).toString('hex').toUpperCase()}`, tableId, waiterId: req.user!.id,
            createdById: req.user!.id, source: 'WAITER', guestCount: Number(guestCount), notes: stringValue(note) || null,
            status, approvedAt: rules.autoApprove ? new Date() : null, subtotal, serviceCharge, serviceFeePercent: restaurant.serviceFeePercent, totalAmount: subtotal.plus(serviceCharge), items: { create: lines } }, include: includeOrder });
        if (!table!.assignedWaiterId) await tx.table.update({ where: { id: tableId }, data: { assignedWaiterId: req.user!.id } });
        await audit(tx, req.user!.id, order, 'ORDER_CREATED', { guestCount });
        if (rules.autoApprove) await queueKitchenPrint(tx, order.id, 'initial');
        return order;
    });
    changed({ orderId: result.id, tableId: result.tableId, status: result.status }); res.status(201).json({ success: true, data: result });
});
router.post('/orders', requireRole(['WAITER', 'ADMIN']), createOrder);
serviceLegacyRouter.post('/orders', authenticateToken, requireRole(['WAITER', 'ADMIN']), createOrder);

const approveOrder = wrap(async (req, res) => {
    const result = await serviceMutation(req, 'WAITER_APPROVE', async tx => {
        await lockWaiters(tx, [req.user!.id]);
        const order = await lockOrder(tx, req.params.id);
        await authorizeService(tx, req.user!, 'assign', order); assertOrderFresh(order, req.body.updatedAt); assertEditable(order);
        if (order.waiterId && order.waiterId !== req.user!.id && req.user!.role !== 'ADMIN') fail(409, 'Buyurtma boshqa ofitsantga biriktirilgan');
        if (!pendingStatuses.includes(order.status)) fail(409, 'Buyurtma allaqachon tasdiqlangan');
        const updated = await tx.order.update({ where: { id: order.id }, data: { waiterId: order.waiterId || req.user!.id, status: 'TASDIQLANDI', approvedAt: new Date() } });
        if (order.tableId) await tx.table.updateMany({ where: { id: order.tableId, assignedWaiterId: null }, data: { assignedWaiterId: updated.waiterId } });
        await audit(tx, req.user!.id, updated, 'ORDER_APPROVED', { waiterId: updated.waiterId }); await queueKitchenPrint(tx, order.id, 'initial'); return updated;
    });
    changed({ orderId: result.id, tableId: result.tableId, status: result.status }); res.json({ success: true, data: result });
});
router.post('/orders/:id/approve', requireRole(['WAITER', 'ADMIN']), approveOrder);
serviceLegacyRouter.post('/orders/:id/approve', authenticateToken, requireRole(['WAITER', 'ADMIN']), approveOrder);
const rejectOrder = wrap(async (req, res) => {
    if (!stringValue(req.body.reason)) fail(400, 'Rad etish sababi kerak');
    const result = await serviceMutation(req, 'SERVICE_REJECT', async tx => {
        const order = await lockOrder(tx, req.params.id); await authorizeService(tx, req.user!, 'assign', order); assertOrderFresh(order, req.body.updatedAt); assertEditable(order);
        if (!(await getSettings(tx, 'orders')).cancellation) fail(403, 'Bekor qilish o‘chirilgan');
        if (order.waiterId && order.waiterId !== req.user!.id && req.user!.role !== 'ADMIN') fail(403, 'Buyurtma boshqa ofitsantga tegishli');
        if (!pendingStatuses.includes(order.status)) fail(409, 'Oshxonaga yuborilgan buyurtma uchun bekor qilish so‘rovi kerak');
        await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'BEKOR_QILINDI' } });
        const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'BEKOR_QILINDI' } });
        await audit(tx, req.user!.id, updated, 'ORDER_REJECTED', { reason: req.body.reason }); return updated;
    }); changed({ orderId: result.id, tableId: result.tableId, status: result.status }); res.json({ success: true, data: result });
});
router.post('/orders/:id/reject', rejectOrder);
serviceLegacyRouter.post('/orders/:id/reject', authenticateToken, requireRole(['WAITER', 'ADMIN']), rejectOrder);

router.post('/orders/:id/assign', wrap(async (req, res) => {
    const result = await serviceMutation(req, 'SERVICE_ASSIGN', async tx => {
        await lockWaiters(tx, [req.user!.id]);
        const order = await lockOrder(tx, req.params.id); await authorizeService(tx, req.user!, 'assign', order); assertOrderFresh(order, req.body.updatedAt); assertEditable(order);
        if (order.waiterId && order.waiterId !== req.user!.id) fail(409, 'Buyurtmani boshqa ofitsant olgan');
        const updated = await tx.order.update({ where: { id: order.id }, data: { waiterId: req.user!.id } });
        if (order.tableId) await tx.table.updateMany({ where: { id: order.tableId, assignedWaiterId: null }, data: { assignedWaiterId: req.user!.id } });
        await audit(tx, req.user!.id, updated, 'ORDER_ASSIGNED', { waiterId: req.user!.id }); return updated;
    }); changed({ orderId: result.id, tableId: result.tableId }); res.json({ success: true, data: result });
}));

router.post('/orders/:id/items/:itemId/status', wrap(async (req, res) => {
    const target = req.body.status;
    if (!['TAYYORLANMOQDA', 'TAYYOR', 'OLIB_KETILDI', 'STOLGA_YETKAZILDI'].includes(target)) fail(400, 'Taom holati noto‘g‘ri');
    const result = await serviceMutation(req, 'SERVICE_ITEM_STATUS', async tx => {
        const order = await lockOrder(tx, req.params.id);
        await authorizeService(tx, req.user!, ['OLIB_KETILDI', 'STOLGA_YETKAZILDI'].includes(target) ? 'deliver' : 'kitchen', order);
        assertOrderFresh(order, req.body.updatedAt);
        if (pendingStatuses.includes(order.status) || closedServiceStatuses.includes(order.status)) fail(409, 'Buyurtma xizmat uchun ochiq emas');
        if (order.processingById && order.processingAt && Date.now() - order.processingAt.getTime() < 600000) fail(409, 'Kassir buyurtmani qayta ishlamoqda');
        const item = order.items.find(i => i.id === req.params.itemId); if (!item) fail(404, 'Taom topilmadi');
        const next = { YANGI: 'TAYYORLANMOQDA', TASDIQLANDI: 'TAYYORLANMOQDA', TAYYORLANMOQDA: 'TAYYOR', TAYYOR: 'OLIB_KETILDI', OLIB_KETILDI: 'STOLGA_YETKAZILDI' };
        if (next[item!.status] !== target) fail(409, 'Taom holati o‘zgargan yoki amal ketma-ketligi noto‘g‘ri');
        await tx.orderItem.update({ where: { id: item!.id }, data: { status: target, ...(target === 'OLIB_KETILDI' ? { pickedUpAt: new Date() } : {}), ...(target === 'STOLGA_YETKAZILDI' ? { deliveredAt: new Date() } : {}) } });
        const status = aggregateItemStatus(order.items.map(i => i.id === item!.id ? { ...i, status: target } : i), order.status);
        const updated = await tx.order.update({ where: { id: order.id }, data: { status, ...(status === 'STOLGA_YETKAZILDI' ? { completedAt: new Date() } : {}), ...(target === 'TAYYORLANMOQDA' && !order.sentToKitchenAt ? { sentToKitchenAt: new Date() } : {}) } });
        await audit(tx, req.user!.id, updated, 'ITEM_STATUS_CHANGED', { itemId: item!.id, name: item!.menuItem.name, status: target }); return { ...updated, itemStatus: target };
    }); changed({ orderId: result.id, tableId: result.tableId, status: result.status, itemStatus: result.itemStatus });
    if (result.itemStatus === 'TAYYOR') emitSocketEvent('kitchen_order_ready', { orderId: result.id });
    res.json({ success: true, data: result });
}));

router.post('/orders/:id/notes/ack', wrap(async (req, res) => {
    const result = await serviceMutation(req, 'SERVICE_NOTE_ACK', async tx => {
        const order = await lockOrder(tx, req.params.id); await authorizeService(tx, req.user!, 'kitchen', order); assertOrderFresh(order, req.body.updatedAt);
        const data = { noteAcknowledgedAt: new Date(), noteAcknowledgedById: req.user!.id };
        if (req.body.itemId) {
            if (!order.items.some(i => i.id === req.body.itemId)) fail(404, 'Taom topilmadi');
            await tx.orderItem.update({ where: { id: req.body.itemId }, data });
        }
        const updated = await tx.order.update({ where: { id: order.id }, data: req.body.itemId ? { updatedAt: new Date() } : data });
        await audit(tx, req.user!.id, updated, 'KITCHEN_NOTE_READ', { itemId: req.body.itemId }); return updated;
    }); changed({ orderId: result.id, tableId: result.tableId }); res.json({ success: true, data: result });
}));
router.post('/orders/:id/notes', wrap(async (req, res) => {
    const note = stringValue(req.body.note); if (!note) fail(400, 'Izohni kiriting');
    const result = await serviceMutation(req, 'SERVICE_NOTE', async tx => {
        const order = await lockOrder(tx, req.params.id);
        await authorizeService(tx, req.user!, req.user!.role === 'KITCHEN' ? 'kitchen' : 'requestCancel', order);
        assertOrderFresh(order, req.body.updatedAt);
        if (closedServiceStatuses.includes(order.status)) fail(409, 'Yopilgan buyurtmaga izoh qo‘shilmaydi');
        const text = `${req.user!.role === 'KITCHEN' ? 'Oshxona' : 'Ofitsant'} ${req.user!.fullName}: ${note}`;
        let updated;
        if (req.body.itemId) {
            const item = order.items.find(i => i.id === req.body.itemId); if (!item) fail(404, 'Taom topilmadi');
            await tx.orderItem.update({ where: { id: item!.id }, data: { notes: [item!.notes, text].filter(Boolean).join('\n'), noteAcknowledgedAt: null, noteAcknowledgedById: null } });
            updated = await tx.order.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
        } else updated = await tx.order.update({ where: { id: order.id }, data: { notes: [order.notes, text].filter(Boolean).join('\n'), noteAcknowledgedAt: null, noteAcknowledgedById: null } });
        await audit(tx, req.user!.id, updated, 'SERVICE_NOTE_ADDED', { itemId: req.body.itemId, note }); return updated;
    }); changed({ orderId: result.id, tableId: result.tableId }); res.json({ success: true, data: result });
}));

const requestReturn = wrap(async (req, res) => {
    const { orderItemId, quantity, reason } = req.body || {}, kind = req.body.kind || 'RETURN';
    if (!['RETURN', 'CANCEL'].includes(kind) || !stringValue(reason) || !stringValue(orderItemId, 100)) fail(400, 'Taom va sabab kerak');
    const amount = qty(quantity);
    const result = await serviceMutation(req, 'SERVICE_REQUEST', async tx => {
        const order = await lockOrder(tx, req.params.id); await authorizeService(tx, req.user!, kind === 'RETURN' ? 'requestReturn' : 'requestCancel', order); assertOrderFresh(order, req.body.updatedAt);
        const item = order.items.find(i => i.id === orderItemId); if (!item || item.status === 'BEKOR_QILINDI') fail(404, 'Faol taom topilmadi');
        if (order.status === 'BEKOR_QILINDI' || order.status === 'QAYTARILDI') fail(409, 'Buyurtma yopilgan');
        if (kind === 'CANCEL') { assertEditable(order); if (!(await getSettings(tx, 'orders')).cancellation) fail(403, 'Bekor qilish o‘chirilgan'); }
        const returned = await tx.refundItem.aggregate({ where: { orderItemId }, _sum: { quantity: true } });
        const waiting = await tx.serviceRequest.aggregate({ where: { orderItemId, status: 'KUTILMOQDA' }, _sum: { quantity: true } });
        if (amount.plus(returned._sum.quantity || 0).plus(waiting._sum.quantity || 0).plus(item!.cancelledQuantity).greaterThan(item!.quantity)) fail(409, 'So‘rov miqdori qolgan taomdan oshdi');
        const created = await tx.serviceRequest.create({ data: { orderId: order.id, orderItemId, quantity: amount, kind, reason: reason.trim(), requestedById: req.user!.id } });
        await audit(tx, req.user!.id, order, kind === 'RETURN' ? 'WAITER_RETURN_REQUESTED' : 'WAITER_CANCEL_REQUESTED', created); return created;
    }); changed({ orderId: result.orderId }); res.status(201).json({ success: true, data: result });
});
const returnItem = wrap(async (req, res) => {
    const orderItemId = stringValue(req.body?.orderItemId, 100), reason = stringValue(req.body?.reason);
    if (!orderItemId || !reason) fail(400, 'Taom va qaytarish sababi kerak');
    const quantity = qty(req.body.quantity), method = req.body.method || 'NAQD';
    const result = await serviceMutation(req, 'WAITER_RETURN', async tx => {
        const order = await lockOrder(tx, req.params.id);
        await authorizeService(tx, req.user!, 'requestReturn', order);
        assertOrderFresh(order, req.body.updatedAt);
        if (['BEKOR_QILINDI', 'QAYTARILDI'].includes(order.status)) fail(409, 'Buyurtma yopilgan');
        if (order.processingById && order.processingAt && Date.now() - order.processingAt.getTime() < 600000) fail(409, 'Kassir buyurtmani qayta ishlamoqda');
        const item = order.items.find(entry => entry.id === orderItemId);
        if (!item || item.status === 'BEKOR_QILINDI') fail(404, 'Faol taom topilmadi');
        const received = decimalSum(order.payments.map(payment => payment.amount))
            .plus(decimalSum((order.debt?.payments || []).map(payment => payment.amount)));
        const previous = await tx.refundItem.aggregate({ where: { orderItemId }, _sum: { quantity: true } });
        const pending = await tx.serviceRequest.aggregate({ where: { orderItemId, kind: 'RETURN', status: 'KUTILMOQDA' }, _sum: { quantity: true } });
        const alreadyReturned = new Prisma.Decimal(previous._sum.quantity || 0).plus(item.cancelledQuantity || 0);
        if (alreadyReturned.plus(pending._sum.quantity || 0).plus(quantity).greaterThan(item.quantity)) fail(409, 'Qaytarish miqdori qolgan taomdan oshdi');

        let refund: any = null, amount = new Prisma.Decimal(0);
        if (received.greaterThan(0)) {
            refund = await refundServiceLine(tx, order, item, quantity, req.user!, reason, method, `${req.body.idempotencyKey}_refund`);
            amount = refund.amount;
        } else {
            assertEditable(order);
            const cancelledQuantity = item.cancelledQuantity.plus(quantity);
            const cancelledAmount = item.unitPrice.mul(quantity).toDecimalPlaces(2);
            const totalPrice = item.totalPrice.minus(cancelledAmount);
            const itemStatus = cancelledQuantity.equals(item.quantity) ? 'BEKOR_QILINDI' : item.status;
            await tx.orderItem.update({ where: { id: item.id }, data: { cancelledQuantity, totalPrice, status: itemStatus } });
            const subtotal = order.subtotal.minus(cancelledAmount);
            const serviceCharge = subtotal.mul(order.serviceFeePercent).div(100).toDecimalPlaces(2);
            const discount = Prisma.Decimal.min(order.discount, subtotal.plus(serviceCharge));
            const totalAmount = subtotal.plus(serviceCharge).minus(discount);
            amount = order.totalAmount.minus(totalAmount).toDecimalPlaces(2);
            await tx.order.update({ where: { id: order.id }, data: {
                subtotal, serviceCharge, discount, totalAmount,
                status: aggregateItemStatus(order.items.map(entry => entry.id === item.id ? { ...entry, status: itemStatus } : entry), order.status)
            } });
        }
        const updatedOrder = await tx.order.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
        await audit(tx, req.user!.id, updatedOrder, 'WAITER_RETURNED_ITEM', {
            name: item.menuItem.name, quantity, amount, reason, waiter: req.user!.fullName, table: order.table?.number
        });
        await queueKitchenReturnPrint(tx, order.id, `${req.body.idempotencyKey}_kitchen`, item.id, quantity.toString(), reason, req.user!.fullName);
        return { id: order.id, orderNumber: order.orderNumber, tableId: order.tableId, itemId: item.id,
            itemName: item.menuItem.name, quantity: quantity.toString(), amount: amount.toString(), reason, waiter: req.user!.fullName,
            tableNumber: order.table?.number, roomName: order.table?.room?.name, refundId: refund?.id || null };
    });
    changed({ orderId: result.id, tableId: result.tableId });
    emitSocketEvent('return_alert', { ...result, alert: `! QAYTARILDI: ${result.itemName} × ${result.quantity}` });
    res.status(201).json({ success: true, data: result });
});
router.post('/orders/:id/return', returnItem);
serviceLegacyRouter.post('/orders/:id/return', authenticateToken, requireRole(['WAITER', 'ADMIN']), returnItem);
router.post('/orders/:id/requests', requestReturn);
serviceLegacyRouter.post('/orders/:id/return-item', authenticateToken, requireRole(['WAITER', 'ADMIN']), requestReturn);
router.get('/requests', wrap(async (req, res) => {
    const where: any = req.user!.role === 'WAITER' ? { requestedById: req.user!.id } : req.user!.role === 'KITCHEN' ? { kind: 'CANCEL' } : {};
    if (req.query.status) where.status = String(req.query.status);
    const requests = await prisma.serviceRequest.findMany({ where, include: { order: { select: { id: true, orderNumber: true, totalAmount: true, updatedAt: true, table: true } }, orderItem: { include: { menuItem: { select: { id: true, name: true } } } }, requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } }, orderBy: { createdAt: where.status === 'KUTILMOQDA' ? 'asc' : 'desc' }, take: 200 });
    res.json({ success: true, data: requests });
}));
router.post('/requests/:id/decision', wrap(async (req, res) => {
    if (!['TASDIQLANDI', 'RAD_ETILDI'].includes(req.body.status) || !stringValue(req.body.reason)) fail(400, 'Qaror va sabab kerak');
    const result = await serviceMutation(req, 'SERVICE_DECISION', async tx => {
        const request = await tx.serviceRequest.findUnique({ where: { id: req.params.id } }); if (!request) fail(404, 'So‘rov topilmadi');
        const order = await lockOrder(tx, request!.orderId);
        const fresh = await tx.serviceRequest.findUniqueOrThrow({ where: { id: request!.id } });
        await authorizeService(tx, req.user!, fresh.kind === 'CANCEL' ? 'cancelReview' : 'review', order);
        if (fresh.status !== 'KUTILMOQDA') fail(409, 'So‘rovga qaror berilgan');
        const item = order.items.find(i => i.id === fresh.orderItemId)!;
        let refund: any = null, cancelledAmount = new Prisma.Decimal(0);
        if (req.body.status === 'TASDIQLANDI') {
            const received = decimalSum(order.payments.map(p => p.amount)).plus(decimalSum((order.debt?.payments || []).map(p => p.amount)));
            if (fresh.kind === 'RETURN' && received.greaterThan(0)) refund = await refundServiceLine(tx, order, item, fresh.quantity, req.user!, fresh.reason, req.body.method || 'NAQD', req.body.idempotencyKey + '_refund');
            else {
                assertEditable(order);
                if (!(await getSettings(tx, 'orders')).cancellation) fail(403, 'Bekor qilish o‘chirilgan');
                const cancelled = item.cancelledQuantity.plus(fresh.quantity); if (cancelled.greaterThan(item.quantity)) fail(409, 'Taom miqdori oshdi');
                const totalPrice = item.unitPrice.mul(item.quantity.minus(cancelled)).toDecimalPlaces(2); cancelledAmount = item.totalPrice.minus(totalPrice);
                const itemStatus = cancelled.equals(item.quantity) ? 'BEKOR_QILINDI' : item.status;
                await tx.orderItem.update({ where: { id: item.id }, data: { cancelledQuantity: cancelled, totalPrice, status: itemStatus } });
                const subtotal = order.subtotal.minus(cancelledAmount), serviceCharge = subtotal.mul(order.serviceFeePercent).div(100).toDecimalPlaces(2);
                const discount = Prisma.Decimal.min(order.discount, subtotal.plus(serviceCharge));
                const status = aggregateItemStatus(order.items.map(i => i.id === item.id ? { ...i, status: itemStatus } : i), order.status);
                await tx.order.update({ where: { id: order.id }, data: { subtotal, serviceCharge, discount, totalAmount: subtotal.plus(serviceCharge).minus(discount), status } });
            }
            // Restocking is an explicit admin decision for a named stock product, never a recipe reversal.
            if (req.body.stockDisposition === 'RESTOCK') {
                if (req.user!.role !== 'ADMIN') fail(403, 'Omborga qaytarish qarorini admin beradi');
                const inventoryId = stringValue(req.body.inventoryId, 100), quantity = qty(req.body.restockQuantity);
                await tx.$queryRaw`SELECT "id" FROM "InventoryProduct" WHERE "id" = ${inventoryId} FOR UPDATE`;
                const inventory = await tx.inventoryProduct.findUnique({ where: { id: inventoryId } }); if (!inventory) fail(404, 'Ombor mahsuloti topilmadi');
                await tx.inventoryProduct.update({ where: { id: inventoryId }, data: { quantity: { increment: quantity } } });
                await tx.inventoryTransaction.create({ data: { inventoryId, userId: req.user!.id, type: 'QAYTARISH', quantityChange: quantity, quantityBefore: inventory!.quantity, quantityAfter: inventory!.quantity.plus(quantity), reason: req.body.reason, referenceOrderId: order.id, menuItemId: item.menuItemId } });
            } else if (req.body.stockDisposition && req.body.stockDisposition !== 'DISCARD') fail(400, 'Ombor qarori noto‘g‘ri');
        }
        const updated = await tx.serviceRequest.update({ where: { id: fresh.id }, data: { status: req.body.status, decidedById: req.user!.id, decidedAt: new Date(), decisionReason: req.body.reason.trim(), refundId: refund?.id, amount: refund?.amount || cancelledAmount,
            stockDisposition: req.body.status === 'TASDIQLANDI' && req.body.stockDisposition === 'RESTOCK' ? 'RESTOCK' : 'DISCARD',
            ...(req.body.status === 'TASDIQLANDI' && req.body.stockDisposition === 'RESTOCK' ? { restockInventoryId: req.body.inventoryId, restockQuantity: qty(req.body.restockQuantity) } : {}) } });
        const finalOrder = await tx.order.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
        await audit(tx, req.user!.id, finalOrder, 'SERVICE_REQUEST_DECIDED', updated); return updated;
    }); changed({ orderId: result.orderId });
    if (result.stockDisposition === 'RESTOCK') emitSocketEvent('inventory_updated', { inventoryIds: [result.restockInventoryId] });
    res.json({ success: true, data: result });
}));

router.post('/orders/:id/transfer', wrap(async (req, res) => {
    if (!stringValue(req.body.reason) || (!req.body.tableId && !req.body.waiterId)) fail(400, 'Yangi stol yoki ofitsant va sabab kerak');
    const result = await serviceMutation(req, 'SERVICE_TRANSFER', async tx => {
        await lockWaiters(tx, [req.user!.id, typeof req.body.waiterId === 'string' ? req.body.waiterId : '']);
        const order = await lockOrder(tx, req.params.id); assertOrderFresh(order, req.body.updatedAt); assertEditable(order);
        const rules = await getSettings(tx, 'orders'), data: any = {};
        if (req.body.tableId) {
            await authorizeService(tx, req.user!, 'transfer', order); if (!rules.tableTransfer) fail(403, 'Stol ko‘chirish o‘chirilgan');
            const table = await tx.table.findFirst({ where: { id: req.body.tableId, isActive: true, room: { isActive: true } } }); if (!table) fail(404, 'Faol stol topilmadi');
            await authorizeService(tx, req.user!, 'read', { table, waiterId: table!.assignedWaiterId }); data.tableId = table!.id;
        }
        if (req.body.waiterId) {
            await authorizeService(tx, req.user!, 'reassign', order); if (!rules.waiterReassignment) fail(403, 'Ofitsant almashtirish o‘chirilgan');
            const waiter = await tx.user.findFirst({ where: { id: req.body.waiterId, role: 'WAITER', isActive: true } }); if (!waiter) fail(404, 'Faol ofitsant topilmadi'); data.waiterId = waiter!.id;
        }
        const updated = await tx.order.update({ where: { id: order.id }, data });
        if (updated.tableId) await tx.table.updateMany({ where: { id: updated.tableId, assignedWaiterId: null }, data: { assignedWaiterId: updated.waiterId } });
        await audit(tx, req.user!.id, updated, 'ORDER_TRANSFERRED', { fromTableId: order.tableId, fromWaiterId: order.waiterId, ...data, reason: req.body.reason });
        return { ...updated, previousTableId: order.tableId };
    }); changed({ orderId: result.id, tableId: result.tableId, previousTableId: result.previousTableId }); res.json({ success: true, data: result });
}));

router.post('/tables/:id/assign', wrap(async (req, res) => {
    const result = await serviceMutation(req, 'SERVICE_TABLE_ASSIGN', async tx => {
        await authorizeService(tx, req.user!, 'assign');
        await tx.$queryRaw`SELECT "id" FROM "Table" WHERE "id" = ${req.params.id} FOR UPDATE`;
        const table = await tx.table.findFirst({ where: { id: req.params.id, isActive: true } }); if (!table) fail(404, 'Stol topilmadi');
        const waiterId = req.user!.role === 'ADMIN' ? req.body.waiterId : req.user!.id;
        if (!await tx.user.findFirst({ where: { id: waiterId, role: 'WAITER', isActive: true } })) fail(400, 'Faol ofitsant kerak');
        if (table!.assignedWaiterId && table!.assignedWaiterId !== waiterId) {
            if (req.user!.role !== 'ADMIN') fail(409, 'Stol boshqa ofitsantga biriktirilgan');
            if (!stringValue(req.body.reason)) fail(400, 'Biriktirishni o‘zgartirish sababi kerak');
        }
        const updated = await tx.table.update({ where: { id: table!.id }, data: { assignedWaiterId: waiterId } });
        await tx.auditLog.create({ data: { userId: req.user!.id, action: 'TABLE_ASSIGNED', entity: 'Table', entityId: table!.id, oldValue: JSON.stringify(table), newValue: JSON.stringify({ waiterId, reason: req.body.reason }) } }); return updated;
    }); changed({ tableId: result.id }); res.json({ success: true, data: result });
}));
router.post('/tables/:id/release', wrap(async (req, res) => {
    const result = await serviceMutation(req, 'SERVICE_TABLE_RELEASE', async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Table" WHERE "id" = ${req.params.id} FOR UPDATE`;
        const table = await tx.table.findUnique({ where: { id: req.params.id } }); if (!table) fail(404, 'Stol topilmadi');
        await authorizeService(tx, req.user!, 'assign', { table, waiterId: table!.assignedWaiterId });
        if (req.user!.role !== 'ADMIN' && table!.assignedWaiterId && table!.assignedWaiterId !== req.user!.id) fail(403, 'Stol boshqa ofitsantga tegishli');
        if (await tx.order.count({ where: { tableId: table!.id, status: { notIn: closedServiceStatuses } } })) fail(409, 'Stolda faol buyurtma bor');
        const updated = await tx.table.update({ where: { id: table!.id }, data: { assignedWaiterId: null } });
        await tx.auditLog.create({ data: { userId: req.user!.id, action: 'TABLE_RELEASED', entity: 'Table', entityId: table!.id } }); return updated;
    }); changed({ tableId: result.id }); res.json({ success: true, data: result });
}));
router.get('/menu', wrap(async (_req, res) => {
    const [menu, popular] = await Promise.all([prisma.menuItem.findMany({ where: { isActive: true, category: { isActive: true } }, select: { id: true, name: true, unit: true, sellingPrice: true, available: true, unavailableReason: true, imageUrl: true, category: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }), prisma.orderItem.groupBy({ by: ['menuItemId'], where: { status: { not: 'BEKOR_QILINDI' }, order: { status: { notIn: ['BEKOR_QILINDI', 'QAYTARILDI'] }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 10 })]);
    res.json({ success: true, data: menu, popular: popular.map(p => p.menuItemId) });
}));
router.post('/menu/:id/availability', wrap(async (req, res) => {
    if (typeof req.body.available !== 'boolean' || (!req.body.available && !stringValue(req.body.reason))) fail(400, 'Sotuv holati va sabab kerak');
    const result = await serviceMutation(req, 'SERVICE_MENU_AVAILABILITY', async tx => {
        await authorizeService(tx, req.user!, 'kitchen');
        const item = await tx.menuItem.update({ where: { id: req.params.id }, data: { available: req.body.available, unavailableReason: req.body.available ? null : req.body.reason } });
        await tx.auditLog.create({ data: { userId: req.user!.id, action: 'MENU_AVAILABILITY', entity: 'MenuItem', entityId: item.id, newValue: JSON.stringify({ available: item.available, reason: item.unavailableReason }) } }); return item;
    }); emitSocketEvent('menu_updated', { menuItemId: result.id }); res.json({ success: true, data: result });
}));

const getCalls = wrap(async (req, res) => {
    const policy = await servicePolicy(prisma), where: any = {};
    if (req.query.history !== 'true') where.status = { not: 'YAKUNLANDI' };
    if (req.user!.role === 'WAITER') where.OR = [{ kind: 'CASHIER_ASSIST', calledById: req.user!.id }, { kind: 'CUSTOMER', ...(policy.scope === 'OWN' ? { table: { OR: [{ assignedWaiterId: req.user!.id }, { assignedWaiterId: null }] } } : {}) }];
    else if (req.user!.role === 'CASHIER') where.kind = 'CASHIER_ASSIST';
    else if (req.user!.role === 'KITCHEN') fail(403, 'Chaqiruvlar oshxona vakolatiga kirmaydi');
    const calls = await prisma.waiterCall.findMany({ where, include: { table: { include: { room: true } }, calledBy: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, completedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(req.path === '/waiter/calls' ? calls.map(c => ({ ...c, tableNumber: c.table.number })) : { success: true, data: calls });
});
router.get('/calls', getCalls); serviceLegacyRouter.get('/waiter/calls', authenticateToken, requireRole(['WAITER', 'CASHIER', 'ADMIN']), getCalls);
const cashierCall = wrap(async (req, res) => {
    const tableId = stringValue(req.body?.tableId, 100); if (!tableId) fail(400, 'Stolni tanlang');
    const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Table" WHERE "id" = ${tableId} FOR UPDATE`;
        const table = await tx.table.findFirst({ where: { id: tableId, isActive: true, room: { isActive: true } } }); if (!table) fail(404, 'Stol topilmadi');
        await authorizeService(tx, req.user!, 'read', { table, waiterId: table!.assignedWaiterId });
        const existing = await tx.waiterCall.findFirst({ where: { tableId, kind: 'CASHIER_ASSIST', status: { not: 'YAKUNLANDI' } } });
        return existing || tx.waiterCall.create({ data: { tableId, kind: 'CASHIER_ASSIST', calledById: req.user!.id } });
    }); emitSocketEvent('waiter_call', { callId: result.id, tableId, kind: result.kind }); res.json({ success: true, data: result });
});
router.post('/calls/cashier', requireRole(['WAITER', 'ADMIN']), cashierCall);
serviceLegacyRouter.post('/waiter/cashier-call', authenticateToken, requireRole(['WAITER', 'ADMIN']), cashierCall);
for (const action of ['accept', 'complete']) {
    const handler = wrap(async (req, res) => {
        const result = await prisma.$transaction(async tx => {
            const call = await tx.waiterCall.findUnique({ where: { id: req.params.id }, include: { table: true } }); if (!call) fail(404, 'Chaqiruv topilmadi');
            callRights(call, req.user, await servicePolicy(tx));
            if (action === 'complete' && call!.acceptedById !== req.user!.id && req.user!.role !== 'ADMIN') fail(403, 'Chaqiruvni qabul qilgan xodim yakunlaydi');
            const updated = await tx.waiterCall.updateMany({ where: { id: call!.id, status: action === 'accept' ? 'YANGI' : 'QABUL_QILINDI', acceptedById: call!.acceptedById }, data: action === 'accept' ? { status: 'QABUL_QILINDI', acceptedById: req.user!.id, acceptedAt: new Date() } : { status: 'YAKUNLANDI', completedById: req.user!.id, completedAt: new Date() } });
            if (!updated.count) {
                const fresh = await tx.waiterCall.findUniqueOrThrow({ where: { id: call!.id } });
                if (action === 'accept' && fresh.acceptedById === req.user!.id && fresh.status === 'QABUL_QILINDI' || action === 'complete' && fresh.completedById === req.user!.id && fresh.status === 'YAKUNLANDI') return fresh;
                fail(409, 'Chaqiruvni boshqa xodim olgan yoki holati o‘zgargan');
            }
            await tx.auditLog.create({ data: { userId: req.user!.id, action: `CALL_${action.toUpperCase()}`, entity: 'WaiterCall', entityId: call!.id } });
            return tx.waiterCall.findUniqueOrThrow({ where: { id: call!.id } });
        }); emitSocketEvent('waiter_call_updated', { callId: result.id, tableId: result.tableId, kind: result.kind, status: result.status }); res.json({ success: true, data: result });
    });
    router.post(`/calls/:id/${action}`, handler);
    serviceLegacyRouter.post(`/waiter/calls/:id/${action}`, authenticateToken, requireRole(['WAITER', 'CASHIER', 'ADMIN']), handler);
}

router.get('/summary', wrap(async (req, res) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()), from = new Date(`${today}T00:00:00+05:00`);
    const own = req.user!.role === 'WAITER' ? { waiterId: req.user!.id } : {};
    const [created, active, payments, debtPayments, refunds, waiter, calls, served, completedCount, cancelledCount] = await Promise.all([
        prisma.order.findMany({ where: { ...own, createdAt: { gte: from }, status: { not: 'BEKOR_QILINDI' } } }),
        prisma.order.findMany({ where: { AND: [await scopeWhere(req.user), { status: { notIn: closedServiceStatuses } }] }, select: { id: true, tableId: true, waiterId: true } }),
        prisma.payment.findMany({ where: { createdAt: { gte: from }, order: own } }),
        prisma.debtPayment.findMany({ where: { createdAt: { gte: from }, debt: { order: own } } }),
        prisma.refund.findMany({ where: { createdAt: { gte: from }, order: own } }),
        prisma.user.findUnique({ where: { id: req.user!.id }, select: { waiterProfile: true } }),
        prisma.waiterCall.count({ where: { status: { not: 'YAKUNLANDI' }, OR: [{ acceptedById: req.user!.id }, { calledById: req.user!.id }] } }),
        prisma.order.findMany({ where: { ...own, completedAt: { gte: from }, status: { notIn: ['BEKOR_QILINDI', 'QAYTARILDI'] } }, select: { tableId: true } }),
        prisma.order.count({ where: { ...own, paidAt: { gte: from }, status: { in: ['TOLANDI', 'YAKUNLANDI'] } } }),
        prisma.order.count({ where: { ...own, createdAt: { gte: from }, status: 'BEKOR_QILINDI' } })
    ]);
    const receiptTotal = decimalSum(payments.map(p => p.amount)).plus(decimalSum(debtPayments.map(p => p.amount))).minus(decimalSum(refunds.map(p => p.amount)));
    const commission = receiptTotal.mul(waiter?.waiterProfile?.commissionPercent || 0).div(100).toDecimalPlaces(2);
    res.json({ success: true, data: { date: today, createdOrders: created.length, createdTotal: decimalSum(created.map(o => o.totalAmount)), receiptTotal, commission,
        commissionRate: waiter?.waiterProfile?.commissionPercent || 0, completedCount, cancelledCount,
        guests: created.reduce((s, o) => s + o.guestCount, 0), servedTables: new Set(served.map(o => o.tableId).filter(Boolean)).size,
        activeOrders: active.length, activeTables: new Set(active.map(o => o.tableId).filter(Boolean)).size, unfinishedCalls: calls, activeOwnOrders: active.filter(o => o.waiterId === req.user!.id).length } });
}));
router.post('/handover', wrap(async (req, res) => {
    if (!stringValue(req.body.reason) || !stringValue(req.body.waiterId, 100)) fail(400, 'Ofitsant va topshirish sababi kerak');
    const result = await serviceMutation(req, 'SERVICE_HANDOVER', async tx => {
        await authorizeService(tx, req.user!, 'reassign');
        await lockWaiters(tx, [req.user!.id, req.body.waiterId]);
        if (!(await getSettings(tx, 'orders')).waiterReassignment) fail(403, 'Ofitsant almashtirish o‘chirilgan');
        const target = await tx.user.findFirst({ where: { id: req.body.waiterId, role: 'WAITER', isActive: true } }); if (!target || target.id === req.user!.id) fail(400, 'Boshqa faol ofitsantni tanlang');
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "waiterId" = ${req.user!.id} ORDER BY "id" FOR UPDATE`;
        const orders = await tx.order.findMany({ where: { waiterId: req.user!.id, status: { notIn: closedServiceStatuses } }, include: includeOrder });
        const ids = orders.map(o => o.id).sort();
        if (JSON.stringify(ids) !== JSON.stringify(Array.isArray(req.body.orderIds) ? [...req.body.orderIds].sort() : [])) fail(409, 'Faol buyurtmalar o‘zgardi. Smena holatini yangilang');
        for (const order of orders) {
            // Financially frozen orders can be handed over, but not moved or financially changed.
            if (order.processingById && order.processingAt && Date.now() - order.processingAt.getTime() < 600000) fail(409, 'Kassir band buyurtma bor. Keyinroq topshiring');
            const updated = await tx.order.update({ where: { id: order.id }, data: { waiterId: target!.id } });
            await audit(tx, req.user!.id, updated, 'SHIFT_HANDOVER', { toWaiterId: target!.id, reason: req.body.reason });
        }
        const tables = await tx.table.updateMany({ where: { assignedWaiterId: req.user!.id }, data: { assignedWaiterId: target!.id } });
        const calls = await tx.waiterCall.updateMany({ where: { acceptedById: req.user!.id, kind: 'CUSTOMER', status: 'QABUL_QILINDI' }, data: { acceptedById: target!.id, acceptedAt: new Date() } });
        const detail = { orderIds: ids, tables: tables.count, calls: calls.count, waiterId: target!.id, reason: req.body.reason };
        await tx.auditLog.create({ data: { userId: req.user!.id, action: 'SHIFT_HANDOVER', entity: 'User', entityId: req.user!.id, newValue: JSON.stringify(detail) } });
        return { orders: ids.length, ...detail };
    }); changed({ type: 'handover' }); emitSocketEvent('waiter_call_updated', { type: 'handover' }); res.json({ success: true, data: result });
}));
export default router;
