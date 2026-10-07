"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deductOrderRecipes = deductOrderRecipes;
const client_1 = require("@prisma/client");
const units_1 = require("./units");
async function deductOrderRecipes(tx, orderId, userId) {
    const claimed = await tx.order.updateMany({
        where: { id: orderId, recipesDeductedAt: null },
        data: { recipesDeductedAt: new Date() }
    });
    if (claimed.count === 0)
        return [];
    const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
            items: {
                select: {
                    quantity: true,
                    menuItem: {
                        select: {
                            id: true,
                            name: true,
                            recipes: {
                                select: {
                                    quantity: true,
                                    unit: true,
                                    inventory: { select: { id: true, name: true, unit: true } }
                                }
                            }
                        }
                    }
                }
            }
        }
    });
    if (!order)
        throw new Error('ORDER_NOT_FOUND');
    const changedInventoryIds = new Set();
    for (const orderItem of order.items) {
        for (const recipe of orderItem.menuItem.recipes) {
            const perDishQuantity = new client_1.Prisma.Decimal(recipe.quantity);
            const fromUnit = recipe.unit || recipe.inventory.unit;
            const requestedQuantity = perDishQuantity.mul(orderItem.quantity);
            const deduction = (0, units_1.convertQuantity)(requestedQuantity, fromUnit, recipe.inventory.unit);
            if (!deduction.isFinite() || !deduction.greaterThan(0)) {
                throw new Error('RECIPE_QUANTITY_INVALID');
            }
            const current = await tx.inventoryProduct.findUnique({
                where: { id: recipe.inventory.id },
                select: { quantity: true }
            });
            if (!current)
                throw new Error('RECIPE_INVENTORY_NOT_FOUND');
            const before = new client_1.Prisma.Decimal(current.quantity);
            const after = before.minus(deduction);
            const updated = await tx.inventoryProduct.updateMany({
                where: { id: recipe.inventory.id, quantity: { gte: deduction } },
                data: { quantity: { decrement: deduction } }
            });
            if (updated.count !== 1)
                throw new Error(`RECIPE_STOCK_SHORT:${recipe.inventory.name}`);
            await tx.inventoryTransaction.create({
                data: {
                    inventoryId: recipe.inventory.id,
                    type: 'SOTUV',
                    quantityChange: deduction.negated(),
                    quantityBefore: before,
                    quantityAfter: after,
                    reason: `${orderItem.menuItem.name}, buyurtma ${orderId}`,
                    referenceOrderId: orderId,
                    menuItemId: orderItem.menuItem.id,
                    userId
                }
            });
            changedInventoryIds.add(recipe.inventory.id);
        }
    }
    return [...changedInventoryIds];
}
