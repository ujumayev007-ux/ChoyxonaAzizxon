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
// Department printer mapping based on menuItem.kitchenSection or category
const DEPARTMENT_PRINTERS = {
    'Kaboblar': 'Kabobxona',
    'Shashlik': 'Kabobxona',
    'Mangal': 'Kabobxona',
    'Baliqlar': 'Baliqxona',
    'Baliq': 'Baliqxona',
    'Deniz Mahsulotlari': 'Baliqxona',
    'Fastfood': 'Fastfood',
    'Fast Food': 'Fastfood',
    'Burger': 'Fastfood',
    'Sendvich': 'Fastfood',
    'Lavash': 'Fastfood',
    'Osh': 'Umumiy Oshxona',
    'Palov': 'Umumiy Oshxona',
    'Sho\'rva': 'Umumiy Oshxona',
    'Salat': 'Umumiy Oshxona',
    'Ichimliklar': 'Umumiy Oshxona',
    'Shirinliklar': 'Umumiy Oshxona',
    'Umumiy': 'Umumiy Oshxona',
    'Umumiy Oshxona': 'Umumiy Oshxona',
};
function getDepartmentForItem(item) {
    // First try kitchenSection
    if (item.kitchenSection && DEPARTMENT_PRINTERS[item.kitchenSection]) {
        return DEPARTMENT_PRINTERS[item.kitchenSection];
    }
    // Fallback to category name
    if (item.category?.name && DEPARTMENT_PRINTERS[item.category.name]) {
        return DEPARTMENT_PRINTERS[item.category.name];
    }
    // Default
    return 'Umumiy Oshxona';
}
async function dispatchToDepartmentPrinters(order) {
    try {
        // Group items by department
        const departmentItems = new Map();
        for (const item of order.items) {
            if (['TAYYOR', 'STOLGA_YETKAZILDI', 'BEKOR_QILINDI'].includes(item.status))
                continue;
            const dept = getDepartmentForItem(item.menuItem);
            if (!departmentItems.has(dept)) {
                departmentItems.set(dept, []);
            }
            departmentItems.get(dept).push(item);
        }
        // Create print jobs for each department
        for (const [department, items] of Array.from(departmentItems.entries())) {
            // Find active printer for this department
            const printer = await db_1.prisma.printer.findFirst({
                where: { department, isActive: true },
                select: { id: true, name: true, department: true, paperWidth: true }
            });
            if (!printer) {
                console.warn(`No active printer found for department: ${department}`);
                continue;
            }
            // Build print payload without prices
            const printPayload = {
                restaurantName: 'ChoyxonaAzizxon',
                department,
                orderNumber: order.orderNumber,
                table: order.table ? `${order.table.room?.name || ''} / Stol ${order.table.number}` : 'Olib ketish',
                waiter: order.waiter?.fullName || 'Nomaʼlum',
                createdAt: new Date(order.createdAt).toISOString(),
                items: items.map(item => ({
                    name: item.menuItem.name,
                    quantity: `${item.quantity} ${item.menuItem.unit}`,
                    notes: item.notes || null
                })),
                notes: order.notes || null
            };
            await db_1.prisma.printJob.create({
                data: {
                    orderId: order.id,
                    printerId: printer.id,
                    payload: JSON.stringify(printPayload),
                    status: 'KUTILMOQDA',
                    jobType: 'KITCHEN'
                }
            });
            console.log(`Print job dispatched to ${department} printer (${printer.name}) for order ${order.orderNumber}`);
        }
    }
    catch (error) {
        console.error('Failed to dispatch print jobs:', error);
    }
}
router.get('/orders', async (_req, res) => {
    try {
        const orders = await db_1.prisma.order.findMany({
            where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA', 'TAYYOR'] } },
            include: {
                waiter: { select: { fullName: true } },
                table: { select: { number: true, room: { select: { name: true } } } },
                items: { include: { menuItem: { select: { id: true, name: true, unit: true, kitchenSection: true, category: { select: { name: true } } } } } },
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
                where: { id: order.id, status: order.status, updatedAt: order.updatedAt },
                data: {
                    status,
                    ...(status === 'TAYYORLANMOQDA' ? { sentToKitchenAt: new Date() } : {}),
                    ...(status === 'STOLGA_YETKAZILDI' ? { completedAt: new Date() } : {})
                }
            });
            if (!changed.count)
                return null;
            await tx.orderItem.updateMany({
                where: { orderId: order.id, status: { notIn: ['TAYYOR', 'STOLGA_YETKAZILDI', 'BEKOR_QILINDI'] } },
                data: { status }
            });
            await tx.orderStatusHistory.create({
                data: { orderId: order.id, status, userId: req.user.id, comment: 'Oshxona paneli' }
            });
            return tx.order.findUniqueOrThrow({ where: { id: order.id } });
        });
        if (!updated)
            return res.status(409).json({ success: false, message: 'Buyurtma holati o‘zgargan, qayta yuklang' });
        // Dispatch to department printers when order starts preparing
        if (status === 'TAYYORLANMOQDA') {
            // Fetch full order with items for printing
            const fullOrder = await db_1.prisma.order.findUnique({
                where: { id: updated.id },
                include: {
                    waiter: { select: { fullName: true } },
                    table: { select: { number: true, room: { select: { name: true } } } },
                    items: { include: { menuItem: { select: { id: true, name: true, unit: true, kitchenSection: true, category: { select: { name: true } } } } } },
                }
            });
            if (fullOrder) {
                await dispatchToDepartmentPrinters(fullOrder);
            }
        }
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
