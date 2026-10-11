import { prisma } from './db';
import { getSettings } from './settings';
import { randomUUID } from 'crypto';
export async function recordFailure(kind: 'failedPayments' | 'backupFailures') {
    try {
        const config = await getSettings(prisma, 'alerts');
        if (config[kind]) await prisma.systemAlert.create({ data: { id: randomUUID(), kind, message: kind === 'failedPayments' ? 'To‘lovni saqlashda xatolik yuz berdi. To‘lovlar tarixini tekshiring.' : 'Zaxira nusxasini yaratib bo‘lmadi.' } });
    } catch { console.error('Ogohlantirish saqlanmadi'); }
}
export async function refreshAlerts() {
    const config = await getSettings(prisma, 'alerts'), now = Date.now();
    const alerts: { id: string; kind: string; message: string }[] = [];
    if (config.lowStock) {
        const rows = await prisma.inventoryProduct.findMany({ where: { isActive: true } });
        for (const row of rows) if (row.quantity.lte(row.minQuantity)) alerts.push({ id: `stock:${row.id}`, kind: 'lowStock', message: `${row.name}: ${row.quantity} ${row.unit} qoldi` });
    }
    if (config.delayedOrderMinutes > 0) {
        const rows = await prisma.order.findMany({ where: { status: { in: ['TASDIQLANDI', 'OSHXONAGA_YUBORILDI', 'TAYYORLANMOQDA'] }, createdAt: { lt: new Date(now - config.delayedOrderMinutes * 60000) } }, take: 200 });
        for (const row of rows) alerts.push({ id: `order:${row.id}`, kind: 'delayedOrder', message: `Buyurtma №${row.orderNumber} kechikmoqda` });
    }
    if (config.unclosedShiftHours > 0) {
        const rows = await prisma.cashSession.findMany({ where: { closedAt: null, openedAt: { lt: new Date(now - config.unclosedShiftHours * 3600000) } } });
        for (const row of rows) alerts.push({ id: `shift:${row.id}`, kind: 'unclosedShift', message: `Kassa smenasi ${row.openedAt.toISOString()} dan beri yopilmagan` });
    }
    if (config.printerFailures) {
        const rows = await prisma.printJob.findMany({ where: { OR: [{ status: 'XATOLIK' }, { status: { in: ['KUTILMOQDA', 'CHOP_ETILMOQDA'] }, createdAt: { lt: new Date(now - 300000) } }] }, take: 200, orderBy: { createdAt: 'desc' } });
        for (const row of rows) alerts.push({ id: `printer:${row.id}`, kind: 'printerFailures', message: 'Chek yuborilmadi yoki printer 5 daqiqadan beri javob bermayapti. Cheklar navbatini tekshiring.' });
    }
    await prisma.$transaction(async tx => {
        for (const alert of alerts) await tx.systemAlert.upsert({ where: { id: alert.id }, create: alert, update: { message: alert.message, resolvedAt: null } });
        await tx.systemAlert.updateMany({ where: { kind: { in: ['lowStock', 'delayedOrder', 'unclosedShift', 'printerFailures'] }, resolvedAt: null, id: { notIn: alerts.map(a => a.id) } }, data: { resolvedAt: new Date() } });
    });
}
export function startAlertMonitor() {
    let busy = false; const timer = setInterval(async () => { if (busy) return; busy = true; try { await refreshAlerts(); } catch { console.error('Ogohlantirishlar yangilanmadi'); } finally { busy = false; } }, 60000); timer.unref();
}
