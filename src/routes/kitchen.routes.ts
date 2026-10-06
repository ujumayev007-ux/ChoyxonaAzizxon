import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';

const router = Router();
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
    TASDIQLANDI: 'TAYYORLANMOQDA',
    OSHXONAGA_YUBORILDI: 'TAYYORLANMOQDA',
    TAYYORLANMOQDA: 'TAYYOR',
    TAYYOR: 'STOLGA_YETKAZILDI'
};

router.get('/orders', async (_req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA', 'TAYYOR'] } },
            include: {
                waiter: { select: { fullName: true } },
                table: { select: { number: true, room: { select: { name: true } } } },
                items: { include: { menuItem: { select: { id: true, name: true, unit: true } } } },
            },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});

router.patch('/orders/:id/status', async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });

        const status = nextStatus[order.status];
        if (!status || status !== req.body.status) {
            return res.status(400).json({ success: false, message: 'Buyurtma holati noto‘g‘ri' });
        }

        const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
                status,
                ...(status === 'TAYYORLANMOQDA' ? { sentToKitchenAt: new Date() } : {}),
                ...(status === 'STOLGA_YETKAZILDI' ? { completedAt: new Date() } : {}),
                statusHistory: { create: { status, comment: 'Oshxona paneli' } }
            }
        });
        emitSocketEvent('order_status_updated', { orderId: updated.id, status });
        if (status === 'TAYYORLANMOQDA') emitSocketEvent('kitchen_order_started', { orderId: updated.id });
        if (status === 'TAYYOR') emitSocketEvent('kitchen_order_ready', { orderId: updated.id });
        if (status === 'STOLGA_YETKAZILDI') emitSocketEvent('kitchen_order_completed', { orderId: updated.id });
        res.json({ success: true, message: 'Buyurtma holati yangilandi', data: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server bilan aloqa uzildi' });
    }
});

export default router;
