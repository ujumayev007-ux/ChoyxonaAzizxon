"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withOrderReturnDetails = withOrderReturnDetails;
const client_1 = require("@prisma/client");
function withOrderReturnDetails(order) {
    const returned = new Map();
    const refunded = new Map();
    for (const refund of order.refunds || []) {
        for (const item of refund.items || []) {
            refunded.set(item.orderItemId, (refunded.get(item.orderItemId) || new client_1.Prisma.Decimal(0)).plus(item.quantity));
        }
    }
    for (const request of order.serviceRequests || []) {
        if (request.kind !== 'RETURN' || request.status !== 'TASDIQLANDI' || request.refundId)
            continue;
        returned.set(request.orderItemId, (returned.get(request.orderItemId) || new client_1.Prisma.Decimal(0)).plus(request.quantity));
    }
    for (const [itemId, quantity] of refunded)
        returned.set(itemId, (returned.get(itemId) || new client_1.Prisma.Decimal(0)).plus(quantity));
    const items = (order.items || []).map((item) => {
        const quantity = new client_1.Prisma.Decimal(item.quantity);
        const cancelledQuantity = new client_1.Prisma.Decimal(item.cancelledQuantity || 0);
        const availableQuantity = client_1.Prisma.Decimal.max(0, quantity.minus(cancelledQuantity));
        const returnedQuantity = returned.get(item.id) || new client_1.Prisma.Decimal(0);
        const remainingQuantity = client_1.Prisma.Decimal.max(0, availableQuantity.minus(returnedQuantity));
        const remainingTotalPrice = availableQuantity.isZero()
            ? new client_1.Prisma.Decimal(0)
            : new client_1.Prisma.Decimal(item.totalPrice).mul(remainingQuantity).div(availableQuantity).toDecimalPlaces(2);
        return { ...item, returnedQuantity: returned.get(item.id) || new client_1.Prisma.Decimal(0), remainingQuantity, remainingTotalPrice };
    });
    const refundsTotal = (order.refunds || []).reduce((sum, refund) => sum.plus(refund.amount), new client_1.Prisma.Decimal(0));
    const netTotal = order.totalAmount === undefined
        ? undefined
        : client_1.Prisma.Decimal.max(0, new client_1.Prisma.Decimal(order.totalAmount).minus(refundsTotal));
    return { ...order, items, ...(netTotal ? { netTotal } : {}) };
}
