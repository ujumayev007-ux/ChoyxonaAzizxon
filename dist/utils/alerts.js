"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFailure = recordFailure;
exports.refreshAlerts = refreshAlerts;
exports.startAlertMonitor = startAlertMonitor;
const db_1 = require("./db");
const settings_1 = require("./settings");
const crypto_1 = require("crypto");
async function recordFailure(kind) {
    try {
        const config = await (0, settings_1.getSettings)(db_1.prisma, 'alerts');
        if (config[kind])
            await db_1.prisma.systemAlert.create({ data: { id: (0, crypto_1.randomUUID)(), kind, message: kind === 'failedPayments' ? 'To‘lovni saqlashda xatolik yuz berdi. To‘lovlar tarixini tekshiring.' : 'Zaxira nusxasini yaratib bo‘lmadi.' } });
    }
    catch {
        console.error('Ogohlantirish saqlanmadi');
    }
}
async function refreshAlerts() {
    const config = await (0, settings_1.getSettings)(db_1.prisma, 'alerts'), now = Date.now();
    const alerts = [];
    if (config.lowStock) {
        const rows = await db_1.prisma.inventoryProduct.findMany({ where: { isActive: true } });
        for (const row of rows)
            if (row.quantity.lte(row.minQuantity))
                alerts.push({ id: `stock:${row.id}`, kind: 'lowStock', message: `${row.name}: ${row.quantity} ${row.unit} qoldi` });
    }
    if (config.delayedOrderMinutes > 0) {
        const rows = await db_1.prisma.order.findMany({ where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA'] }, createdAt: { lt: new Date(now - config.delayedOrderMinutes * 60000) } }, take: 200 });
        for (const row of rows)
            alerts.push({ id: `order:${row.id}`, kind: 'delayedOrder', message: `Buyurtma №${row.orderNumber} kechikmoqda` });
    }
    if (config.unclosedShiftHours > 0) {
        const rows = await db_1.prisma.cashSession.findMany({ where: { closedAt: null, openedAt: { lt: new Date(now - config.unclosedShiftHours * 3600000) } } });
        for (const row of rows)
            alerts.push({ id: `shift:${row.id}`, kind: 'unclosedShift', message: `Kassa smenasi ${row.openedAt.toISOString()} dan beri yopilmagan` });
    }
    if (config.printerFailures) {
        const rows = await db_1.prisma.printJob.findMany({ where: { OR: [{ status: 'XATOLIK' }, { status: { in: ['KUTILMOQDA', 'CHOP_ETILMOQDA'] }, createdAt: { lt: new Date(now - 300000) } }] }, take: 200, orderBy: { createdAt: 'desc' } });
        for (const row of rows)
            alerts.push({ id: `printer:${row.id}`, kind: 'printerFailures', message: 'Chek yuborilmadi yoki printer 5 daqiqadan beri javob bermayapti. Cheklar navbatini tekshiring.' });
    }
    await db_1.prisma.$transaction(async (tx) => {
        for (const alert of alerts)
            await tx.systemAlert.upsert({ where: { id: alert.id }, create: alert, update: { message: alert.message, resolvedAt: null } });
        await tx.systemAlert.updateMany({ where: { kind: { in: ['lowStock', 'delayedOrder', 'unclosedShift', 'printerFailures'] }, resolvedAt: null, id: { notIn: alerts.map(a => a.id) } }, data: { resolvedAt: new Date() } });
    });
}
function startAlertMonitor() {
    let busy = false;
    const timer = setInterval(async () => { if (busy)
        return; busy = true; try {
        await refreshAlerts();
    }
    catch {
        console.error('Ogohlantirishlar yangilanmadi');
    }
    finally {
        busy = false;
    } }, 60000);
    timer.unref();
}
