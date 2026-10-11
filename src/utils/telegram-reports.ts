import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { getSettings } from './settings';
import { formatTelegramMessage, sendToActiveSubscribers } from './telegram';
export function reportSlot(now: Date, timezone: string, hourly: boolean, daily: boolean, times: string): string | null {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
    const time = `${parts.hour}:${parts.minute}`;
    return (hourly && parts.minute === '00') || (daily && times.split(',').includes(time)) ? `${parts.year}-${parts.month}-${parts.day}:${time}` : null;
}
export async function buildTelegramReport(from: Date, to: Date, title = 'Restoran hisoboti') {
    const config = await getSettings(prisma, 'telegramReport');
    const period = { gte: from, lte: to }, zero = new Prisma.Decimal(0);
    const [payments, collections, expenses, refunds, orders, debt, stock] = await Promise.all([
        prisma.payment.groupBy({ by: ['method'], where: { createdAt: period }, _sum: { amount: true } }),
        prisma.debtPayment.groupBy({ by: ['method'], where: { createdAt: period }, _sum: { amount: true } }),
        prisma.expense.aggregate({ where: { createdAt: period }, _sum: { amount: true } }),
        prisma.refund.aggregate({ where: { createdAt: period }, _sum: { amount: true } }),
        prisma.order.findMany({ where: { paidAt: period, status: { in: ['TOLANDI', 'YAKUNLANDI', 'QAYTARILDI'] } }, select: { totalAmount: true, waiter: { select: { id: true, fullName: true } }, items: { select: { quantity: true, menuItem: { select: { internalCostPrice: true } } } } } }),
        prisma.customerDebt.aggregate({ _sum: { remaining: true } }),
        prisma.inventoryProduct.findMany({ where: { isActive: true }, select: { quantity: true, minQuantity: true } })
    ]);
    const amount = (method: string) => [...payments, ...collections].filter(p => p.method === method).reduce((sum, p) => sum.plus(p._sum.amount || 0), zero);
    const revenue = amount('NAQD').plus(amount('PLASTIK')).plus(amount('ELEKTRON'));
    const expense = expenses._sum.amount || zero, returned = refunds._sum.amount || zero;
    const sales = orders.reduce((sum, o) => sum.plus(o.totalAmount), zero);
    const cost = orders.reduce((sum, o) => o.items.reduce((subtotal, i) => subtotal.plus(i.quantity.mul(i.menuItem.internalCostPrice)), sum), zero);
    const lines = [`Davr: ${from.toISOString()} — ${to.toISOString()}`];
    if (config.revenue) lines.push(`Undirilgan tushum: ${revenue.toFixed(2)} so‘m`, `Qaytarishlar: ${returned.toFixed(2)} so‘m`);
    if (config.cash) lines.push(`Naqd: ${amount('NAQD').toFixed(2)} so‘m`);
    if (config.card) lines.push(`Karta: ${amount('PLASTIK').toFixed(2)} so‘m`);
    if (config.electronic) lines.push(`Elektron: ${amount('ELEKTRON').toFixed(2)} so‘m`);
    if (config.expenses) lines.push(`Xarajatlar: ${expense.toFixed(2)} so‘m`);
    if (config.netProfit) lines.push(`Hisobiy sof foyda (joriy tannarx bo‘yicha): ${sales.minus(cost).minus(expense).minus(returned).toFixed(2)} so‘m`);
    if (config.debts) lines.push(`Jami qolgan qarz: ${(debt._sum.remaining || zero).toFixed(2)} so‘m`);
    if (config.inventory) lines.push(`Kam qolgan mahsulotlar: ${stock.filter(p => p.quantity.lte(p.minQuantity)).length} ta`);
    if (config.waiters) {
        const totals = new Map<string, { name: string; count: number; sum: Prisma.Decimal }>();
        for (const order of orders) if (order.waiter) { const row = totals.get(order.waiter.id) || { name: order.waiter.fullName, count: 0, sum: zero }; row.count++; row.sum = row.sum.plus(order.totalAmount); totals.set(order.waiter.id, row); }
        for (const row of [...totals.values()].sort((a, b) => b.sum.comparedTo(a.sum)).slice(0, 20)) lines.push(`${row.name}: ${row.count} buyurtma, ${row.sum.toFixed(2)} so‘m`);
    }
    return formatTelegramMessage(title, lines).slice(0, 4000);
}
export async function dispatchReport(key: string, from: Date, to: Date, title: string) {
    const claimed = await prisma.scheduledReport.createMany({ data: [{ key }], skipDuplicates: true });
    if (!claimed.count) return;
    try {
        const result = await sendToActiveSubscribers(await buildTelegramReport(from, to, title));
        await prisma.scheduledReport.update({ where: { key }, data: { status: result.failed || !result.success ? 'XATOLIK' : 'YUBORILDI' } });
    } catch { await prisma.scheduledReport.update({ where: { key }, data: { status: 'XATOLIK' } }); }
}
export async function runReportSchedule(now = new Date()) {
    const [config, restaurant] = await Promise.all([getSettings(prisma, 'telegramReport'), getSettings(prisma, 'restaurant')]);
    if (!config.enabled) return;
    const slot = reportSlot(now, restaurant.timezone, config.hourly, config.daily, config.times);
    if (slot) await dispatchReport(`time:${slot}`, new Date(now.getTime() - (config.hourly ? 3600000 : 86400000)), now, 'Davriy restoran hisoboti');
    const sessions = await prisma.cashSession.findMany({ where: { OR: [{ openedAt: { gte: new Date(now.getTime() - 86400000) } }, { closedAt: { gte: new Date(now.getTime() - 86400000) } }] }, take: 200 });
    for (const session of sessions) {
        if (config.shiftOpen) await dispatchReport(`open:${session.id}`, session.openedAt, session.openedAt, 'Kassa smenasi ochildi');
        if (config.shiftClose && session.closedAt) await dispatchReport(`close:${session.id}`, session.openedAt, session.closedAt, 'Kassa smenasi yopildi');
    }
}
export function startReportSchedule() {
    let busy = false;
    const timer = setInterval(async () => { if (busy) return; busy = true; try { await runReportSchedule(); } catch { console.error('Telegram jadvali bajarilmadi'); } finally { busy = false; } }, 30000);
    timer.unref();
}
