"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decimalSum = void 0;
exports.orderBalance = orderBalance;
exports.refundServiceLine = refundServiceLine;
const client_1 = require("@prisma/client");
const service_policy_1 = require("./service-policy");
const settings_1 = require("./settings");
const decimalSum = (values) => values.reduce((sum, value) => sum.plus(value || 0), new client_1.Prisma.Decimal(0));
exports.decimalSum = decimalSum;
function orderBalance(order) {
    const paid = (0, exports.decimalSum)(order.payments.map((p) => p.amount));
    const debt = new client_1.Prisma.Decimal(order.debt?.amount || 0);
    const refunds = (0, exports.decimalSum)((order.refunds || []).map((r) => r.amount));
    return { total: order.totalAmount, paid, refunds, debt, debtRemaining: new client_1.Prisma.Decimal(order.debt?.remaining || 0),
        remaining: client_1.Prisma.Decimal.max(0, new client_1.Prisma.Decimal(order.totalAmount).minus(paid).minus(debt)) };
}
// The request decision and the actual monetary refund share the order row lock and transaction.
async function refundServiceLine(tx, order, item, quantity, user, reason, method, key) {
    const settings = await (0, settings_1.getSettings)(tx, 'payments');
    const methods = { NAQD: settings.cash, PLASTIK: settings.card, ELEKTRON: settings.electronic };
    if (!settings.refunds || !Object.hasOwn(methods, method) || !methods[method])
        (0, service_policy_1.fail)(403, 'Qaytarish yoki to‘lov usuli o‘chirilgan');
    if (order.debt?.remaining.greaterThan(0))
        (0, service_policy_1.fail)(409, 'Avval qolgan qarzni yoping');
    const prior = await tx.refundItem.aggregate({ where: { orderItemId: item.id }, _sum: { quantity: true, amount: true } });
    const soldQuantity = new client_1.Prisma.Decimal(item.quantity).minus(item.cancelledQuantity || 0);
    const returned = new client_1.Prisma.Decimal(prior._sum.quantity || 0).plus(quantity);
    if (returned.greaterThan(soldQuantity))
        (0, service_policy_1.fail)(409, 'Qaytarish miqdori sotilgan miqdordan oshdi');
    const budget = (0, service_policy_1.allocateLineBudgets)(order).get(item.id);
    const cumulative = returned.equals(soldQuantity) ? budget : budget.mul(returned).div(soldQuantity).toDecimalPlaces(2);
    const amount = cumulative.minus(prior._sum.amount || 0);
    const paid = (0, exports.decimalSum)(order.payments.map((p) => p.amount)).plus((0, exports.decimalSum)((order.debt?.payments || []).map((p) => p.amount)));
    const refunded = (0, exports.decimalSum)(order.refunds.map((r) => r.amount));
    if (amount.lessThan(0) || amount.greaterThan(paid.minus(refunded)))
        (0, service_policy_1.fail)(409, 'Qaytarish summasi qolgan to‘lovdan oshdi');
    if (user.role !== 'ADMIN' && amount.greaterThan(process.env.REFUND_ADMIN_APPROVAL_THRESHOLD || 500000))
        (0, service_policy_1.fail)(403, 'Bu summa uchun admin tasdig‘i kerak');
    const session = await tx.cashSession.findFirst({ where: { cashierId: user.id, activeCashierId: user.id, closedAt: null } });
    if (settings.requireOpenShift && !session)
        (0, service_policy_1.fail)(403, 'Avval kassa smenasini oching');
    const refund = await tx.refund.create({ data: { orderId: order.id, amount, reason, method: method,
            cashierId: user.id, approvedById: user.role === 'ADMIN' ? user.id : null, idempotencyKey: key,
            items: { create: { orderItemId: item.id, quantity, amount } } } });
    if (method === 'NAQD' && amount.greaterThan(0))
        await tx.cashMovement.create({ data: { sessionId: session?.id, userId: user.id, type: 'REFUND', amount: amount.negated(), note: reason, referenceId: order.id } });
    if (paid.equals(refunded.plus(amount)))
        await tx.order.update({ where: { id: order.id }, data: { status: 'QAYTARILDI' } });
    return refund;
}
