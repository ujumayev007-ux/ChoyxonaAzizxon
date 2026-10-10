"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.post('/:id/items', auth_1.authenticateToken, (0, auth_1.requireRole)(['WAITER']), async (req, res) => {
    const { items, idempotencyKey } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(item => !item || typeof item.productId !== 'string' || !/^\d{1,6}(?:\.\d{1,3})?$/.test(String(item.quantity)) ||
        Number(item.quantity) <= 0 || (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 500))) ||
        typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) {
        res.status(400).json({ success: false, message: 'Qo‘shimcha taomlar ma’lumotlari noto‘g‘ri' });
        return;
    }
    const requestHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify({ orderId: req.params.id, items })).digest('hex');
    try {
        const result = await db_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`;
            const previous = await tx.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
            if (previous) {
                if (previous.userId !== req.user.id || previous.operation !== 'WAITER_ADD_ITEMS' || previous.requestHash !== requestHash)
                    throw new Error('KEY_CONFLICT');
                return { ...JSON.parse(previous.responseJson), duplicate: true };
            }
            const order = await tx.order.findUnique({ where: { id: req.params.id }, include: { payments: true, debt: true } });
            if (!order)
                throw new Error('NOT_FOUND');
            if (order.waiterId !== req.user.id)
                throw new Error('FORBIDDEN');
            const allowed = ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA', 'TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA', 'TAYYOR', 'STOLGA_YETKAZILDI', 'TOLOV_KUTILMOQDA'];
            if (!allowed.includes(order.status) || order.payments.length || order.debt || order.recipesDeductedAt || order.paidAt)
                throw new Error('NOT_EDITABLE');
            if (order.processingById && order.processingAt && Date.now() - order.processingAt.getTime() <= 10 * 60 * 1000)
                throw new Error('LOCKED');
            const menu = await tx.menuItem.findMany({
                where: { id: { in: items.map(item => item.productId) }, isActive: true, category: { isActive: true } }
            });
            const lines = items.map(item => {
                const product = menu.find(entry => entry.id === item.productId);
                if (!product)
                    throw new Error('MENU_INVALID');
                const quantity = new client_1.Prisma.Decimal(String(item.quantity));
                return { menuItemId: product.id, quantity, unitPrice: product.sellingPrice,
                    totalPrice: product.sellingPrice.mul(quantity).toDecimalPlaces(2), status: 'YANGI',
                    notes: `Qo‘shimcha${item.note?.trim() ? ': ' + item.note.trim() : ''}` };
            });
            const addedTotal = lines.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0));
            // Previously finished dishes must not be prepared again when this order returns to the kitchen.
            if (['TAYYOR', 'STOLGA_YETKAZILDI', 'TOLOV_KUTILMOQDA'].includes(order.status)) {
                await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'TAYYOR' } });
            }
            const status = ['YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA', 'TAYYORLANMOQDA'].includes(order.status)
                ? order.status : client_1.OrderStatus.TASDIQLANDI;
            const updated = await tx.order.update({ where: { id: order.id }, data: {
                    subtotal: { increment: addedTotal }, totalAmount: { increment: addedTotal },
                    processingById: null, processingAt: null, status, completedAt: null,
                    items: { create: lines },
                    statusHistory: { create: { status, userId: req.user.id, comment: `Qo‘shimcha taomlar: ${addedTotal} so‘m` } }
                }, select: { id: true, tableId: true, status: true, totalAmount: true } });
            await tx.idempotencyRecord.create({ data: {
                    key: idempotencyKey, userId: req.user.id, operation: 'WAITER_ADD_ITEMS', requestHash,
                    responseJson: JSON.stringify(updated)
                } });
            return updated;
        }, { maxWait: 10000, timeout: 30000 });
        (0, socket_1.emitSocketEvent)('orderUpdate', { orderId: result.id, tableId: result.tableId, status: result.status });
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: result.id, tableId: result.tableId, status: result.status });
        res.json({ success: true, data: result });
    }
    catch (error) {
        const messages = {
            NOT_FOUND: [404, 'Buyurtma topilmadi'], FORBIDDEN: [403, 'Faqat o‘zingizning buyurtmangizga taom qo‘sha olasiz'],
            NOT_EDITABLE: [409, 'To‘lov boshlangan yoki yakunlangan buyurtmaga taom qo‘shib bo‘lmaydi'],
            LOCKED: [409, 'Kassir buyurtmani qayta ishlamoqda. Keyinroq urinib ko‘ring'],
            MENU_INVALID: [400, 'Taom mavjud emas yoki sotuvdan olib tashlangan'],
            KEY_CONFLICT: [409, 'Bu so‘rov identifikatori avval ishlatilgan']
        };
        const [code, message] = messages[error instanceof Error ? error.message : ''] || [500, 'Qo‘shimcha taomlarni saqlab bo‘lmadi. Qayta urinib ko‘ring'];
        res.status(code).json({ success: false, message });
    }
});
exports.default = router;
