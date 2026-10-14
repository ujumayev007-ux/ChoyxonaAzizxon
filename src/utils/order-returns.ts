import { Prisma } from '@prisma/client';

export function withOrderReturnDetails(order: any) {
    const returned = new Map<string, Prisma.Decimal>();
    const refunded = new Map<string, Prisma.Decimal>();
    for (const refund of order.refunds || []) {
        for (const item of refund.items || []) {
            refunded.set(item.orderItemId, (refunded.get(item.orderItemId) || new Prisma.Decimal(0)).plus(item.quantity));
        }
    }
    for (const request of order.serviceRequests || []) {
        if (request.kind !== 'RETURN' || request.status !== 'TASDIQLANDI' || request.refundId) continue;
        returned.set(request.orderItemId, (returned.get(request.orderItemId) || new Prisma.Decimal(0)).plus(request.quantity));
    }
    for (const [itemId, quantity] of refunded) returned.set(itemId, (returned.get(itemId) || new Prisma.Decimal(0)).plus(quantity));

    const items = (order.items || []).map((item: any) => {
        const quantity = new Prisma.Decimal(item.quantity);
        const cancelledQuantity = new Prisma.Decimal(item.cancelledQuantity || 0);
        const availableQuantity = Prisma.Decimal.max(0, quantity.minus(cancelledQuantity));
        const returnedQuantity = returned.get(item.id) || new Prisma.Decimal(0);
        const remainingQuantity = Prisma.Decimal.max(0, availableQuantity.minus(returnedQuantity));
        const remainingTotalPrice = availableQuantity.isZero()
            ? new Prisma.Decimal(0)
            : new Prisma.Decimal(item.totalPrice).mul(remainingQuantity).div(availableQuantity).toDecimalPlaces(2);
        return { ...item, returnedQuantity: returned.get(item.id) || new Prisma.Decimal(0), remainingQuantity, remainingTotalPrice };
    });
    const refundsTotal = (order.refunds || []).reduce((sum: Prisma.Decimal, refund: any) => sum.plus(refund.amount), new Prisma.Decimal(0));
    const netTotal = order.totalAmount === undefined
        ? undefined
        : Prisma.Decimal.max(0, new Prisma.Decimal(order.totalAmount).minus(refundsTotal));
    return { ...order, items, ...(netTotal ? { netTotal } : {}) };
}