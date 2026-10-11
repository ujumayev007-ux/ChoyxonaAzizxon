"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const settings_1 = require("../utils/settings");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
router.post('/:id', async (req, res) => {
    const { action, value, reason } = req.body || {};
    if (!['discount', 'transfer', 'reassign', 'cancel'].includes(action) || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) {
        res.status(400).json({ message: 'Amal va sababni kiriting' });
        return;
    }
    try {
        const order = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id"=${req.params.id} FOR UPDATE`;
            const old = await tx.order.findUniqueOrThrow({ where: { id: req.params.id }, include: { payments: true, debt: true } });
            if (old.payments.length || old.debt || ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'].includes(old.status) || old.recipesDeductedAt ||
                (old.processingById && old.processingAt && Date.now() - old.processingAt.getTime() < 600000))
                throw Error();
            const policy = await (0, settings_1.getSettings)(tx, 'orders');
            let data = {};
            if (action === 'discount') {
                if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value)))
                    throw Error();
                const amount = new client_1.Prisma.Decimal(value), payments = await (0, settings_1.getSettings)(tx, 'payments');
                if (amount.greaterThan(old.subtotal.mul(payments.maxDiscountPercent).div(100)))
                    throw Error();
                data = { discount: amount, totalAmount: old.subtotal.plus(old.serviceCharge).minus(amount) };
            }
            else if (action === 'transfer') {
                if (!policy.tableTransfer || !await tx.table.findFirst({ where: { id: value, isActive: true, room: { isActive: true } } }))
                    throw Error();
                data = { table: { connect: { id: value } } };
            }
            else if (action === 'reassign') {
                if (!policy.waiterReassignment || !await tx.user.findFirst({ where: { id: value, role: 'WAITER', isActive: true } }))
                    throw Error();
                data = { waiter: { connect: { id: value } } };
            }
            else {
                if (!policy.cancellation)
                    throw Error();
                data = { status: 'BEKOR_QILINDI' };
            }
            const updated = await tx.order.update({ where: { id: old.id }, data });
            await tx.auditLog.create({ data: { userId: req.user.id, action: `ORDER_${action.toUpperCase()}`, entity: 'Order', entityId: old.id,
                    oldValue: JSON.stringify({ tableId: old.tableId, waiterId: old.waiterId, discount: old.discount, status: old.status }),
                    newValue: JSON.stringify({ tableId: updated.tableId, waiterId: updated.waiterId, discount: updated.discount, status: updated.status, reason }) } });
            await tx.orderStatusHistory.create({ data: { orderId: old.id, userId: req.user.id, status: updated.status, comment: reason } });
            return updated;
        }, { maxWait: 10000, timeout: 30000 });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: order.id, status: order.status });
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: order.id, status: order.status });
        (0, socket_1.emitSocketEvent)('table_status_updated', {});
        res.json({ success: true });
    }
    catch {
        res.status(409).json({ message: 'Buyurtmani o‘zgartirib bo‘lmaydi. Holat, kassir bandligi, ruxsatlar va limitlarni tekshiring' });
    }
});
exports.default = router;
