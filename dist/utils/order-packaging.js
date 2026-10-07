"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deductPackaging = deductPackaging;
const client_1 = require("@prisma/client");
async function deductPackaging(tx, orderId, userId) {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { packagingDeductedAt: true, packagingItems: { include: { inventory: true } } }
    });
    if (!order || order.packagingDeductedAt || order.packagingItems.length === 0)
        return;
    for (const item of order.packagingItems) {
        const before = new client_1.Prisma.Decimal(item.inventory.quantity);
        if (before.lessThan(item.quantity))
            throw new Error('PACKAGING_STOCK_SHORT');
        const after = before.minus(item.quantity);
        await tx.inventoryProduct.update({ where: { id: item.inventoryId }, data: { quantity: after } });
        await tx.inventoryTransaction.create({
            data: {
                inventoryId: item.inventoryId,
                type: 'SOTUV',
                quantityChange: item.quantity.negated(),
                quantityBefore: before,
                quantityAfter: after,
                reason: `Qadoqlash, buyurtma ${orderId}`,
                userId
            }
        });
    }
    await tx.order.update({ where: { id: orderId }, data: { packagingDeductedAt: new Date() } });
}
