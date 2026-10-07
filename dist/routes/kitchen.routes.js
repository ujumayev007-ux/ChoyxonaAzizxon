"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['KITCHEN', 'ADMIN']));
const nextStatus = {
    TASDIQLANDI: 'TAYYORLANMOQDA',
    OSHXONAGA_YUBORILDI: 'TAYYORLANMOQDA',
    TAYYORLANMOQDA: 'TAYYOR',
    TAYYOR: 'STOLGA_YETKAZILDI'
};
router.get('/orders', async (_req, res) => {
    try {
        const orders = await db_1.prisma.order.findMany({
            where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA', 'TAYYOR'] } },
            include: {
                waiter: { select: { fullName: true } },
                table: { select: { number: true, room: { select: { name: true } } } },
                items: { include: { menuItem: { select: { id: true, name: true, unit: true } } } },
            },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ success: true, data: orders });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});
router.patch('/orders/:id/status', async (req, res) => {
    try {
        const order = await db_1.prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order)
            return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
        const status = nextStatus[order.status];
        if (!status || status !== req.body.status) {
            return res.status(400).json({ success: false, message: 'Buyurtma holati noto‘g‘ri' });
        }
        const updated = await db_1.prisma.$transaction(async (tx) => {
            const changed = await tx.order.updateMany({
                where: { id: order.id, status: order.status },
                data: {
                    status,
                    ...(status === 'TAYYORLANMOQDA' ? { sentToKitchenAt: new Date() } : {}),
                    ...(status === 'STOLGA_YETKAZILDI' ? { completedAt: new Date() } : {})
                }
            });
            if (!changed.count)
                return null;
            await tx.orderStatusHistory.create({
                data: { orderId: order.id, status, userId: req.user.id, comment: 'Oshxona paneli' }
            });
            return tx.order.findUniqueOrThrow({ where: { id: order.id } });
        });
        if (!updated)
            return res.status(409).json({ success: false, message: 'Buyurtma holati o‘zgargan, qayta yuklang' });
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: updated.id, status });
        if (status === 'TAYYORLANMOQDA')
            (0, socket_1.emitSocketEvent)('kitchen_order_started', { orderId: updated.id });
        if (status === 'TAYYOR')
            (0, socket_1.emitSocketEvent)('kitchen_order_ready', { orderId: updated.id });
        if (status === 'STOLGA_YETKAZILDI')
            (0, socket_1.emitSocketEvent)('kitchen_order_completed', { orderId: updated.id });
        res.json({ success: true, message: 'Buyurtma holati yangilandi', data: updated });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server bilan aloqa uzildi' });
    }
});
exports.default = router;
