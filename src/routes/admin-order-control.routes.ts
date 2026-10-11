import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { getSettings } from '../utils/settings';
import { emitSocketEvent } from '../socket';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
router.post('/:id', async (req, res) => {
    const { action, value, reason } = req.body || {};
    if (!['discount', 'transfer', 'reassign', 'cancel'].includes(action) || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) { res.status(400).json({ message: 'Amal va sababni kiriting' }); return; }
    try {
        const order = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${req.params.id} FOR UPDATE`;
            const old = await tx.order.findUniqueOrThrow({ where: { id: req.params.id }, include: { payments: true, debt: true } });
            if (old.payments.length || old.debt || ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'].includes(old.status) || old.recipesDeductedAt ||
                (old.processingById && old.processingAt && Date.now() - old.processingAt.getTime() < 600000)) throw Error();
            const policy = await getSettings(tx, 'orders');
            let data: Prisma.OrderUpdateInput = {};
            if (action === 'discount') {
                if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))) throw Error();
                const amount = new Prisma.Decimal(value), payments = await getSettings(tx, 'payments');
                if (amount.greaterThan(old.subtotal.mul(payments.maxDiscountPercent).div(100))) throw Error();
                data = { discount: amount, totalAmount: old.subtotal.plus(old.serviceCharge).minus(amount) };
            } else if (action === 'transfer') {
                if (!policy.tableTransfer || !await tx.table.findFirst({ where: { id: value, isActive: true, room: { isActive: true } } })) throw Error();
                data = { table: { connect: { id: value } } };
            } else if (action === 'reassign') {
                if (!policy.waiterReassignment || !await tx.user.findFirst({ where: { id: value, role: 'WAITER', isActive: true } })) throw Error();
                data = { waiter: { connect: { id: value } } };
            } else {
                if (!policy.cancellation) throw Error(); data = { status: 'BEKOR_QILINDI' };
            }
            const updated = await tx.order.update({ where: { id: old.id }, data });
            await tx.auditLog.create({ data: { userId: req.user!.id, action: `ORDER_${action.toUpperCase()}`, entity: 'Order', entityId: old.id,
                oldValue: JSON.stringify({ tableId: old.tableId, waiterId: old.waiterId, discount: old.discount, status: old.status }),
                newValue: JSON.stringify({ tableId: updated.tableId, waiterId: updated.waiterId, discount: updated.discount, status: updated.status, reason }) } });
            await tx.orderStatusHistory.create({ data: { orderId: old.id, userId: req.user!.id, status: updated.status, comment: reason } });
            return updated;
        }, { maxWait: 10000, timeout: 30000 });
        emitSocketEvent('orderUpdate', { orderId: order.id, status: order.status }); emitSocketEvent('order_status_updated', { orderId: order.id, status: order.status }); emitSocketEvent('table_status_updated', {});
        res.json({ success: true });
    } catch { res.status(409).json({ message: 'Buyurtmani o‘zgartirib bo‘lmaydi. Holat, kassir bandligi, ruxsatlar va limitlarni tekshiring' }); }
});
export default router;
