import { Prisma } from '@prisma/client';
import { prisma } from './db';
export async function auditMutation<T extends { id: string }>(userId: string, entity: string, action: string, mutation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async tx => {
        const result = await mutation(tx);
        const safe = result as T & { name?: string; sellingPrice?: Prisma.Decimal; isActive?: boolean };
        await tx.auditLog.create({ data: { userId, entity, action, entityId: result.id, newValue: JSON.stringify({ name: safe.name, sellingPrice: safe.sellingPrice, isActive: safe.isActive }) } });
        return result;
    });
}
