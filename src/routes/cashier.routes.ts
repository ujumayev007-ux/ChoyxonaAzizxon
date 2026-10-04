import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { prisma } from '../utils/db'; // Prisma client ulanishi
import { emitSocketEvent } from '../socket';

// TypeScript uchun Express Request obyektiga user turini qo'shish
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// Middleware: Strict Cashier Role Verification
router.use(authenticateToken, requireRole(['cashier', 'admin']));

// 1. Cashier Dashboard Stats & Active Bills
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Bugungi kun boshlanishi

        // Calculate today's totals from payments
        const paymentsToday = await prisma.payment.findMany({
            where: { createdAt: { gte: today } }
        });

        const cashTotal = paymentsToday.filter((p: any) => p.method === 'NAQD' || p.method === 'CASH').reduce((sum, p) => sum + Number(p.amount), 0);
        const cardTotal = paymentsToday.filter((p: any) => p.method === 'PLASTIK' || p.method === 'CARD').reduce((sum, p) => sum + Number(p.amount), 0);
        const electronicTotal = paymentsToday.filter((p: any) => p.method === 'ELEKTRON' || p.method === 'ELECTRONIC').reduce((sum, p) => sum + Number(p.amount), 0);
        const totalRevenue = cashTotal + cardTotal + electronicTotal;

        // Today's expenses
        const expensesToday = await (prisma as any).expense.findMany({
            where: { createdAt: { gte: today } }
        });
        const totalExpenses = expensesToday.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

        // Active table accounts / orders needing payment
        const activeOrders = await prisma.order.findMany({
            where: { 
                status: { notIn: ['YOPILGAN', 'BEKOR_QILINGAN', 'COMPLETED', 'CANCELLED'] as any } 
            },
            include: { 
                waiter: { select: { username: true } }, 
                items: { include: { menuItem: true } } 
            } as any
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
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server xatosi yuz berdi' });
    }
});

// 2. Process Payment with Backend Validation & Change Calculation
router.post('/payments', async (req, res) => {
    try {
        const { orderId, method, amountPaid, customerGiven, transactionRef } = req.body;
        
        // Prisma transaction
        const result = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({
                where: { id: orderId },
                include: { items: true } as any
            });

            if (!order) {
                throw new Error('ORDER_NOT_FOUND');
            }

            if (order.status === 'YOPILGAN' || (order.status as string) === 'COMPLETED') {
                throw new Error('ALREADY_COMPLETED');
            }

            // Validate amount on backend (never trust frontend totals)
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

            // Create payment record
            const payment = await tx.payment.create({
                data: {
                    orderId,
                    method: method || 'NAQD',
                    amount: amountPaid,
                    changeAmount: change,
                    transactionRef: transactionRef || null,
                    cashierId: req.user.id,
                } as any
            });

            // Update order status if fully paid
            const paidAmountField = (order as any).paidAmount || 0;
            const totalPaidSoFar = Number(paidAmountField) + Number(amountPaid);
            const isFullyPaid = totalPaidSoFar >= totalDue;

            const updatedOrder = await tx.order.update({
                where: { id: orderId },
                data: {
                    paidAmount: totalPaidSoFar,
                    status: isFullyPaid ? 'YOPILGAN' : order.status
                } as any
            });

            return { payment, updatedOrder, change, totalPaidSoFar };
        });

        // Emit real-time Socket.io update
        emitSocketEvent('paymentReceived', { 
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
    } catch (error: any) {
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

// 3. Cash Register Shift Management (Open / Close)
router.post('/register/open', async (req, res) => {
    try {
        const { startingBalance } = req.body;
        const activeSession = await (prisma as any).cashSession.findFirst({ 
            where: { status: 'open', cashierId: req.user.id } 
        });
        
        if (activeSession) {
            return res.status(400).json({ success: false, message: 'Kassa allaqachon ochiq' });
        }

        const session = await (prisma as any).cashSession.create({
            data: {
                cashierId: req.user.id,
                startingBalance,
                status: 'open',
                openedAt: new Date()
            }
        });

        res.json({ success: true, message: 'Kassa muvaffaqiyatli ochildi', data: session });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Kassani ochishda xatolik' });
    }
});

router.post('/register/close', async (req, res) => {
    try {
        const { actualCash, closingNote } = req.body;
        const session = await (prisma as any).cashSession.findFirst({ 
            where: { status: 'open', cashierId: req.user.id } 
        });

        if (!session) {
            return res.status(400).json({ success: false, message: 'Kassa ochilmagan' });
        }

        // Calculate expected cash from session transactions
        const systemCash = Number(session.startingBalance) + 500000; 
        const difference = actualCash - systemCash;

        const updatedSession = await (prisma as any).cashSession.update({
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
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Kassani yopishda xatolik' });
    }
});

export default router;