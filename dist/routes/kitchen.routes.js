"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const models_1 = require("../models");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
// Middleware: Strict Kitchen & Admin Role Verification
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['kitchen', 'admin', 'waiter']));
// 1. Get Active Kitchen Orders (Approved, Preparing, Ready)
router.get('/orders', async (req, res) => {
    try {
        const activeOrders = await models_1.db.Order.findAll({
            where: {
                status: {
                    [models_1.db.Sequelize.Op.in]: ['approved', 'preparing', 'ready']
                }
            },
            include: [
                { model: models_1.db.User, as: 'waiter', attributes: ['name'] },
                { model: models_1.db.OrderItem, include: [models_1.db.Dish] }
            ],
            order: [['createdAt', 'ASC']]
        });
        res.json({ success: true, data: activeOrders });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Buyurtmani yuklashda xatolik' });
    }
});
// 2. Update Order Status (Boshlash / Tayyor / Yakunlash)
router.patch('/orders/:id/status', async (req, res) => {
    const t = await models_1.db.sequelize.transaction();
    try {
        const { id } = req.params;
        const { status } = req.body; // 'preparing', 'ready', 'completed'
        const order = await models_1.db.Order.findByPk(id, { include: [models_1.db.OrderItem], transaction: t });
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
        (0, socket_1.emitSocketEvent)('order_status_updated', { orderId: order.id, status });
        if (status === 'preparing')
            (0, socket_1.emitSocketEvent)('kitchen_order_started', { orderId: order.id });
        if (status === 'ready')
            (0, socket_1.emitSocketEvent)('kitchen_order_ready', { orderId: order.id });
        if (status === 'completed')
            (0, socket_1.emitSocketEvent)('kitchen_order_completed', { orderId: order.id });
        res.json({ success: true, message: 'Buyurtma holati yangilandi', data: order });
    }
    catch (error) {
        await t.rollback();
        res.status(500).json({ success: false, message: 'Server bilan aloqa uzildi' });
    }
});
exports.default = router;
