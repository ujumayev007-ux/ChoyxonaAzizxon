"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['cashier', 'admin']));
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const paymentsToday = await db_1.prisma.payment.findMany({
            where: { createdAt: { gte: today } }
        });
        const cashTotal = paymentsToday.filter((p) => p.method === 'NAQD' || p.method === 'CASH').reduce((sum, p) => sum + Number(p.amount), 0);
        const cardTotal = paymentsToday.filter((p) => p.method === 'PLASTIK' || p.method === 'CARD').reduce((sum, p) => sum + Number(p.amount), 0);
        const electronicTotal = paymentsToday.filter((p) => p.method === 'ELEKTRON' || p.method === 'ELECTRONIC').reduce((sum, p) => sum + Number(p.amount), 0);
        const totalRevenue = cashTotal + cardTotal + electronicTotal;
        const expensesToday = await db_1.prisma.expense.findMany({
            where: { createdAt: { gte: today } }
        });
        const totalExpenses = expensesToday.reduce((sum, e) => sum + Number(e.amount), 0);
        const activeOrders = await db_1.prisma.order.findMany({
            where: {
                status: { notIn: ['YOPILGAN', 'BEKOR_QILINGAN', 'COMPLETED', 'CANCELLED'] }
            },
            include: {
                waiter: { select: { username: true } },
                items: { include: { menuItem: true } }
            }
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
        console.error(error);
        res.status(500).json({ success: false, message: 'Server xatosi yuz berdi' });
    }
});
router.post('/payments', async (req, res) => {
    try {
        const { orderId, method, amountPaid, customerGiven, transactionRef } = req.body;
        const result = await db_1.prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({
                where: { id: orderId },
                include: { items: true }
            });
            if (!order) {
                throw new Error('ORDER_NOT_FOUND');
            }
            if (order.status === 'YOPILGAN' || order.status === 'COMPLETED') {
                throw new Error('ALREADY_COMPLETED');
            }
            const totalDue = Number(order.totalAmount) - Number(order.discount || 0);
            if (amountPaid <= 0 || amountPaid > totalDue) {
                throw new Error('INVALID_AMOUNT');
            }
            let change = 0;
            if (method === 'NAQD' || method === 'CASH' || method === 'cash') {
                if (customerGiven < amountPaid) {
                    throw new Error('INSUFFICIENT_CASH');
                }
                change = customerGiven - amountPaid;
            }
            const payment = await tx.payment.create({
                data: {
                    orderId,
                    method: method || 'NAQD',
                    amount: amountPaid,
                    changeAmount: change,
                    transactionRef: transactionRef || null,
                    cashierId: req.user.id,
                }
            });
            const paidAmountField = order.paidAmount || 0;
            const totalPaidSoFar = Number(paidAmountField) + Number(amountPaid);
            const isFullyPaid = totalPaidSoFar >= totalDue;
            const updatedOrder = await tx.order.update({
                where: { id: orderId },
                data: {
                    paidAmount: totalPaidSoFar,
                    status: isFullyPaid ? 'YOPILGAN' : order.status
                }
            });
            return { payment, updatedOrder, change, totalPaidSoFar };
        });
        (0, socket_1.emitSocketEvent)('paymentReceived', {
            orderId,
            paymentId: result.payment.id,
            totalPaidSoFar: result.totalPaidSoFar,
            status: result.updatedOrder.status
        });
        res.json({
            success: true,
            message: 'To‘lov muvaffaqiyatli qabul qilindi',
            data: { change: result.change, paymentId: result.payment.id }
        });
    }
    catch (error) {
        if (error.message === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Buyurtma topilmadi' });
        }
        if (error.message === 'ALREADY_COMPLETED') {
            return res.status(400).json({ success: false, message: 'Bu buyurtma allaqachon to‘langan' });
        }
        if (error.message === 'INVALID_AMOUNT') {
            return res.status(400).json({ success: false, message: 'To‘lov summasi noto‘g‘ri' });
        }
        if (error.message === 'INSUFFICIENT_CASH') {
            return res.status(400).json({ success: false, message: 'Mijoz bergan pul miqdori kam' });
        }
        console.error(error);
        res.status(500).json({ success: false, message: 'To‘lovni amalga oshirib bo‘lmadi' });
    }
});
router.post('/register/open', async (req, res) => {
    try {
        const { startingBalance } = req.body;
        const activeSession = await db_1.prisma.cashSession.findFirst({
            where: { status: 'open', cashierId: req.user.id }
        });
        if (activeSession) {
            return res.status(400).json({ success: false, message: 'Kassa allaqachon ochiq' });
        }
        const session = await db_1.prisma.cashSession.create({
            data: {
                cashierId: req.user.id,
                startingBalance,
                status: 'open',
                openedAt: new Date()
            }
        });
        res.json({ success: true, message: 'Kassa muvaffaqiyatli ochildi', data: session });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Kassani ochishda xatolik' });
    }
});
router.post('/register/close', async (req, res) => {
    try {
        const { actualCash, closingNote } = req.body;
        const session = await db_1.prisma.cashSession.findFirst({
            where: { status: 'open', cashierId: req.user.id }
        });
        if (!session) {
            return res.status(400).json({ success: false, message: 'Kassa ochilmagan' });
        }
        const systemCash = Number(session.startingBalance) + 500000;
        const difference = actualCash - systemCash;
        const updatedSession = await db_1.prisma.cashSession.update({
            where: { id: session.id },
            data: {
                actualCash,
                systemCash,
                difference,
                closingNote,
                status: 'closed',
                closedAt: new Date()
            }
        });
        res.json({ success: true, message: 'Kassa yopildi', data: { difference, systemCash, actualCash } });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Kassani yopishda xatolik' });
    }
});
exports.default = router;
