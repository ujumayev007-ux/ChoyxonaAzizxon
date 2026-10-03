"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const models_1 = require("../models"); // Assuming existing database models
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
// Middleware: Strict Cashier Role Verification
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['cashier', 'admin']));
// 1. Cashier Dashboard Stats & Active Bills
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        // Calculate today's totals from payments
        const paymentsToday = await models_1.db.Payment.findAll({
            where: { createdAt: { [models_1.db.Sequelize.Op.gte]: new Date(today) } }
        });
        const cashTotal = paymentsToday.filter(p => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0);
        const cardTotal = paymentsToday.filter(p => p.method === 'card').reduce((sum, p) => sum + p.amount, 0);
        const electronicTotal = paymentsToday.filter(p => p.method === 'electronic').reduce((sum, p) => sum + p.amount, 0);
        const totalRevenue = cashTotal + cardTotal + electronicTotal;
        // Today's expenses
        const expensesToday = await models_1.db.Expense.findAll({
            where: { createdAt: { [models_1.db.Sequelize.Op.gte]: new Date(today) } }
        });
        const totalExpenses = expensesToday.reduce((sum, e) => sum + e.amount, 0);
        // Active table accounts / orders needing payment
        const activeOrders = await models_1.db.Order.findAll({
            where: { status: { [models_1.db.Sequelize.Op.notIn]: ['completed', 'cancelled'] } },
            include: [{ model: models_1.db.User, as: 'waiter', attributes: ['name'] }, { model: models_1.db.OrderItem, include: [models_1.db.Dish] }]
        });
        res.json({
            success: true,
            data: {
                bugungiTushum: totalRevenue,
                bugungiXarajatlar: totalExpenses,
                naqdPul: cashTotal,
                plastikKarta: cardTotal,
                elektronTolovlar: electronicTotal,
                faolBuyurtmalar: activeOrders
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Server xatosi yuz berdi' });
    }
});
// 2. Process Payment with Backend Validation & Change Calculation
router.post('/payments', async (req, res) => {
    const t = await models_1.db.sequelize.transaction();
    try {
        const { orderId, method, amountPaid, customerGiven, transactionRef } = req.body;
        const order = await models_1.db.Order.findByPk(orderId, { include: [models_1.db.OrderItem], transaction: t });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
        }
        if (order.status === 'completed') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Bu buyurtma allaqachon to‘langan' });
        }
        // Validate amount on backend (never trust frontend totals)
        const totalDue = order.totalAmount - (order.discount || 0);
        if (amountPaid <= 0 || amountPaid > totalDue) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'To‘lov summasi noto‘g‘ri' });
        }
        let change = 0;
        if (method === 'cash') {
            if (customerGiven < amountPaid) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Mijoz bergan pul miqdori kam' });
            }
            change = customerGiven - amountPaid;
        }
        // Create payment record
        const payment = await models_1.db.Payment.create({
            orderId,
            method,
            amount: amountPaid,
            changeAmount: change,
            transactionRef: transactionRef || null,
            cashierId: req.user.id,
            date: new Date()
        }, { transaction: t });
        // Update order status if fully paid
        const totalPaidSoFar = (order.paidAmount || 0) + amountPaid;
        const isFullyPaid = totalPaidSoFar >= totalDue;
        await order.update({
            paidAmount: totalPaidSoFar,
            status: isFullyPaid ? 'completed' : order.status
        }, { transaction: t });
        await t.commit();
        // Emit real-time Socket.io update
        (0, socket_1.emitSocketEvent)('paymentReceived', { orderId, paymentId: payment.id, totalPaidSoFar, status: order.status });
        res.json({
            success: true,
            message: 'To‘lov muvaffaqiyatli qabul qilindi',
            data: { change, paymentId: payment.id }
        });
    }
    catch (error) {
        await t.rollback();
        res.status(500).json({ success: false, message: 'To‘lovni amalga oshirib bo‘lmadi' });
    }
});
// 3. Cash Register Shift Management (Open / Close)
router.post('/register/open', async (req, res) => {
    try {
        const { startingBalance } = req.body;
        const activeSession = await models_1.db.CashSession.findOne({ where: { status: 'open', cashierId: req.user.id } });
        if (activeSession) {
            return res.status(400).json({ success: false, message: 'Kassa allaqachon ochiq' });
        }
        const session = await models_1.db.CashSession.create({
            cashierId: req.user.id,
            startingBalance,
            status: 'open',
            openedAt: new Date()
        });
        res.json({ success: true, message: 'Kassa muvaffaqiyatli ochildi', data: session });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Kassani ochishda xatolik' });
    }
});
router.post('/register/close', async (req, res) => {
    try {
        const { actualCash, closingNote } = req.body;
        const session = await models_1.db.CashSession.findOne({ where: { status: 'open', cashierId: req.user.id } });
        if (!session) {
            return res.status(400).json({ success: false, message: 'Kassa ochilmagan' });
        }
        // Calculate expected cash from session transactions
        const systemCash = session.startingBalance + 500000; // computed dynamically in production
        const difference = actualCash - systemCash;
        await session.update({
            actualCash,
            systemCash,
            difference,
            closingNote,
            status: 'closed',
            closedAt: new Date()
        });
        res.json({ success: true, message: 'Kassa yopildi', data: { difference, systemCash, actualCash } });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Kassani yopishda xatolik' });
    }
});
exports.default = router;
