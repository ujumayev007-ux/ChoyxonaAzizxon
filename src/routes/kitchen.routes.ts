import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';
import { authenticateToken, requireRole } from '../middleware/auth';
import type { Request, Response, NextFunction } from 'express';
import { authorizeService } from '../utils/service-policy';
import { getSettings } from '../utils/settings';
import { checkDeviceAuthorization } from '../services/device.service';

const router = Router();

// TV ekrani xodim PIN-kodisiz ishlaydi, lekin faqat Super Owner tasdiqlagan qurilmaga javob beradi
async function requireApprovedDevice(req: Request, res: Response, next: NextFunction) {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const tenantId = (req.headers['x-tenant-id'] as string) || 'choyxona-azizxon-default-tenant';
    try {
        const check = deviceId ? await checkDeviceAuthorization(tenantId, deviceId, req.headers['x-device-token'] as string | undefined) : { authorized: false };
        if (!check.authorized) return res.status(403).json({ success: false, code: 'DEVICE_UNAUTHORIZED', message: 'TV qurilmasi tasdiqlanmagan' });
        next();
    } catch {
        res.status(500).json({ success: false, message: 'Qurilmani tekshirib bo‘lmadi' });
    }
}

const activeOrdersQuery = () => prisma.order.findMany({
    where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA', 'TAYYOR'] } },
    include: {
        waiter: { select: { fullName: true } },
        table: { select: { number: true, room: { select: { name: true } } } },
        items: { include: { menuItem: { select: { id: true, name: true, unit: true, kitchenSection: true, category: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: 'asc' }
});

router.get('/tv/settings', requireApprovedDevice, async (_req, res) => {
    try { res.json(await getSettings(prisma, 'kitchenTv')); }
    catch { res.status(500).json({ message: 'TV sozlamalari yuklanmadi' }); }
});

router.get('/tv/orders', requireApprovedDevice, async (_req, res) => {
    try { res.json({ success: true, data: await activeOrdersQuery() }); }
    catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});

router.use(authenticateToken, requireRole(['KITCHEN', 'ADMIN']));
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
    TASDIQLANDI: 'TAYYORLANMOQDA',
    OSHXONAGA_YUBORILDI: 'TAYYORLANMOQDA',
    TAYYORLANMOQDA: 'TAYYOR'
};
router.get('/tv-settings', async (_req, res) => {
    try { res.json(await getSettings(prisma, 'kitchenTv')); }
    catch { res.status(500).json({ message: 'TV sozlamalari yuklanmadi' }); }
});

router.get('/orders', async (_req, res) => {
    try {
        const orders = await activeOrdersQuery();
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});

router.patch('/orders/:id/status', async (req: Request<{ id: string }>, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });

        const status = nextStatus[order.status];
        if (!status || status !== req.body.status) {
            return res.status(400).json({ success: false, message: 'Buyurtma holati noto‘g‘ri' });
        }

        const updated = await prisma.$transaction(async tx => {
            await authorizeService(tx, req.user!, 'kitchen', order);
            if (order.processingById && order.processingAt && Date.now() - order.processingAt.getTime() < 600000) return null;
            const changed = await tx.order.updateMany({
                where: { id: order.id, status: order.status, updatedAt: order.updatedAt },
                data: {
                    status,
                    ...(status === 'TAYYORLANMOQDA' ? { sentToKitchenAt: new Date() } : {}),
                    ...(status === 'STOLGA_YETKAZILDI' ? { completedAt: new Date() } : {})
                }
            });
            if (!changed.count) return null;
            await tx.orderItem.updateMany({
                where: { orderId: order.id, status: { notIn: ['TAYYOR', 'OLIB_KETILDI', 'STOLGA_YETKAZILDI', 'BEKOR_QILINDI'] } },
                data: { status }
            });
            await tx.orderStatusHistory.create({
                data: { orderId: order.id, status, userId: req.user!.id, comment: 'Oshxona paneli' }
            });
            return tx.order.findUniqueOrThrow({ where: { id: order.id } });
        });
        if (!updated) return res.status(409).json({ success: false, message: 'Buyurtma holati o‘zgargan, qayta yuklang' });
        
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
