"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditMutation = auditMutation;
const db_1 = require("./db");
async function auditMutation(userId, entity, action, mutation) {
    return db_1.prisma.$transaction(async (tx) => {
        const result = await mutation(tx);
        const safe = result;
        await tx.auditLog.create({ data: { userId, entity, action, entityId: result.id, newValue: JSON.stringify({ name: safe.name, sellingPrice: safe.sellingPrice, isActive: safe.isActive }) } });
        return result;
    });
}
