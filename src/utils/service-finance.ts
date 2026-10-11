import { Prisma, PaymentMethod } from '@prisma/client';
import { allocateLineBudgets, fail } from './service-policy';
import { getSettings } from './settings';

export const decimalSum = (values: any[]) => values.reduce((sum, value) => sum.plus(value || 0), new Prisma.Decimal(0)) as Prisma.Decimal;
export function orderBalance(order: any) {
    const paid = decimalSum(order.payments.map((p: any) => p.amount));
    const debt = new Prisma.Decimal(order.debt?.amount || 0);
    const refunds = decimalSum((order.refunds || []).map((r: any) => r.amount));
    return { total: order.totalAmount, paid, refunds, debt, debtRemaining: new Prisma.Decimal(order.debt?.remaining || 0),
        remaining: Prisma.Decimal.max(0, new Prisma.Decimal(order.totalAmount).minus(paid).minus(debt)) };
}

// The request decision and the actual monetary refund share the order row lock and transaction.
export async function refundServiceLine(tx: Prisma.TransactionClient, order: any, item: any, quantity: Prisma.Decimal, user: any, reason: string, method: string, key: string) {
    const settings = await getSettings(tx, 'payments');
    const methods = { NAQD: settings.cash, PLASTIK: settings.card, ELEKTRON: settings.electronic };
    if (!settings.refunds || !Object.hasOwn(methods, method) || !methods[method]) fail(403, 'Qaytarish yoki to‘lov usuli o‘chirilgan');
    if (order.debt?.remaining.greaterThan(0)) fail(409, 'Avval qolgan qarzni yoping');
    const prior = await tx.refundItem.aggregate({ where: { orderItemId: item.id }, _sum: { quantity: true, amount: true } });
    const soldQuantity = new Prisma.Decimal(item.quantity).minus(item.cancelledQuantity || 0);
    const returned = new Prisma.Decimal(prior._sum.quantity || 0).plus(quantity);
    if (returned.greaterThan(soldQuantity)) fail(409, 'Qaytarish miqdori sotilgan miqdordan oshdi');
    const budget = allocateLineBudgets(order).get(item.id)!;
    const cumulative = returned.equals(soldQuantity) ? budget : budget.mul(returned).div(soldQuantity).toDecimalPlaces(2);
    const amount = cumulative.minus(prior._sum.amount || 0);
    const paid = decimalSum(order.payments.map((p: any) => p.amount)).plus(decimalSum((order.debt?.payments || []).map((p: any) => p.amount)));
    const refunded = decimalSum(order.refunds.map((r: any) => r.amount));
    if (amount.lessThan(0) || amount.greaterThan(paid.minus(refunded))) fail(409, 'Qaytarish summasi qolgan to‘lovdan oshdi');
    if (user.role !== 'ADMIN' && amount.greaterThan(process.env.REFUND_ADMIN_APPROVAL_THRESHOLD || 500000)) fail(403, 'Bu summa uchun admin tasdig‘i kerak');
    const session = await tx.cashSession.findFirst({ where: { cashierId: user.id, activeCashierId: user.id, closedAt: null } });
    if (settings.requireOpenShift && !session) fail(403, 'Avval kassa smenasini oching');
    const refund = await tx.refund.create({ data: { orderId: order.id, amount, reason, method: method as PaymentMethod,
        cashierId: user.id, approvedById: user.role === 'ADMIN' ? user.id : null, idempotencyKey: key,
        items: { create: { orderItemId: item.id, quantity, amount } } } });
    if (method === 'NAQD' && amount.greaterThan(0)) await tx.cashMovement.create({ data: { sessionId: session?.id, userId: user.id, type: 'REFUND', amount: amount.negated(), note: reason, referenceId: order.id } });
    if (paid.equals(refunded.plus(amount))) await tx.order.update({ where: { id: order.id }, data: { status: 'QAYTARILDI' } });
    return refund;
}
