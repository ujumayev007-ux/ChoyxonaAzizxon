import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { db } from '../models';
import { emitSocketEvent } from '../socket';

const router = Router();

// Middleware: Strict Kitchen & Admin Role Verification
router.use(authenticateToken, requireRole(['kitchen', 'admin', 'waiter']));

// 1. Get Active Kitchen Orders (Approved, Preparing, Ready)
router.get('/orders', async (req, res) => {
    try {
        const activeOrders = await db.Order.findAll({
            where: {
                status: {
                    [db.Sequelize.Op.in]: ['approved', 'preparing', 'ready']
                }
            },
            include: [
                { model: db.User, as: 'waiter', attributes: ['name'] },
                { model: db.OrderItem, as: 'OrderItems', include: [{ model: db.Dish }] } // as: 'OrderItems' qo'shildi
            ],
            order: [['createdAt', 'ASC']]
        });

        res.json({ success: true, data: activeOrders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});

// 2. Update Order Status (Boshlash / Tayyor / Yakunlash)
router.patch('/orders/:id/status', async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const { id } = req.params;
        const { status } = req.body; // 'preparing', 'ready', 'completed'

        const order = await db.Order.findByPk(id, { include: [db.OrderItem], transaction: t });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
        }

        if (order.status === status) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Buyurtma allaqachon bu holatda' });
        }

        // Validate Kilogram Osh quantities (100g to 5kg)
        for (const item of order.OrderItems || []) {
            if (item.isKilogramOsh) {
                if (item.quantityGrams < 100 || item.quantityGrams > 5000) {
                    await t.rollback();
                    return res.status(400).json({ 
                        success: false, 
                        message: item.quantityGrams < 100 ? 'Minimal miqdor 100 gramm bo‘lishi kerak' : 'Maximum miqdor 5 kg bo‘lishi kerak' 
                    });
                }
            }
        }

        await order.update({ status }, { transaction: t });
        await t.commit();

        // Broadcast real-time Socket.io status update
        emitSocketEvent('order_status_updated', { orderId: order.id, status });
        if (status === 'preparing') emitSocketEvent('kitchen_order_started', { orderId: order.id });
        if (status === 'ready') emitSocketEvent('kitchen_order_ready', { orderId: order.id });
        if (status === 'completed') emitSocketEvent('kitchen_order_completed', { orderId: order.id });

        res.json({ success: true, message: 'Buyurtma holati yangilandi', data: order });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ success: false, message: 'Server bilan aloqa uzildi' });
    }
});

export default router;
