import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { emitSocketEvent } from '../socket';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
router.get('/history', async (_req, res) => {
    try { res.json(await prisma.inventoryTransaction.findMany({ take: 200, orderBy: { createdAt: 'desc' }, include: { inventory: { select: { name: true, unit: true } }, user: { select: { fullName: true } } } })); }
    catch { res.status(500).json({ message: 'Ombor tarixi yuklanmadi' }); }
});
router.post('/stocktake', async (req, res) => {
    const { items, reason } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 500 || new Set(items.map(i => i?.id)).size !== items.length || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500 || items.some(i => !i || typeof i.id !== 'string' || ['quantity', 'expected', 'minQuantity'].some(k => !/^\d{1,12}(?:\.\d{1,3})?$/.test(String(i[k]))))) { res.status(400).json({ message: 'Sanoq miqdorlari va sababni to‘g‘ri kiriting' }); return; }
    try {
        await prisma.$transaction(async tx => {
            for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
                await tx.$queryRaw`SELECT "id" FROM "InventoryProduct" WHERE "id"=${item.id} FOR UPDATE`;
                const product = await tx.inventoryProduct.findUniqueOrThrow({ where: { id: item.id } });
                if (!product.quantity.equals(item.expected)) throw Error('STALE');
                const quantity = new Prisma.Decimal(item.quantity), minQuantity = new Prisma.Decimal(item.minQuantity);
                await tx.inventoryProduct.update({ where: { id: item.id }, data: { quantity, minQuantity, lowStockNotified: false } });
                await tx.inventoryTransaction.create({ data: { inventoryId: item.id, type: 'TUZATISH', quantityBefore: product.quantity, quantityAfter: quantity, quantityChange: quantity.minus(product.quantity), reason: reason.trim(), userId: req.user!.id } });
                await tx.auditLog.create({ data: { userId: req.user!.id, action: 'INVENTORY_STOCKTAKE', entity: 'InventoryProduct', entityId: item.id, oldValue: JSON.stringify({ quantity: product.quantity, minQuantity: product.minQuantity }), newValue: JSON.stringify({ quantity, minQuantity, reason }) } });
            }
        }, { timeout: 30000 });
        emitSocketEvent('inventory_updated', { inventoryIds: items.map(i => i.id) }); res.json({ success: true });
    } catch { res.status(409).json({ message: 'Ombor o‘zgargan yoki sanoq saqlanmadi. Yangilab qayta tekshiring' }); }
});
export default router;
