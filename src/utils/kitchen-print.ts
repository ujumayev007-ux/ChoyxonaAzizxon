import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export async function queueKitchenPrint(tx: Prisma.TransactionClient, orderId: string, batch: string, itemIds?: string[]) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: {
        table: { include: { room: true } }, waiter: { select: { fullName: true } },
        items: { where: itemIds ? { id: { in: itemIds } } : {}, include: { menuItem: { include: { category: true } } } }
    } });
    const [printers, config] = await Promise.all([
        tx.printer.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
        tx.printConfig.findUnique({ where: { id: 'default' } })
    ]);
    const groups = new Map<string, { printerId: string | null; department: string; categoryIds: string[]; items: typeof order.items }>();
    for (const item of order.items) {
        const category = item.menuItem.category;
        const defaults: Record<string, string> = { Kaboblar: 'Kabobxona', Baliqlar: 'Baliqxona', 'Fast Food': 'Fastfood', Fastfood: 'Fastfood' };
        const department = item.menuItem.kitchenSection || defaults[category.name] || 'Umumiy Oshxona';
        const printer = printers.find(p => p.categoryIds.includes(category.id)) || printers.find(p => !p.categoryIds.length && p.department === department);
        const key = printer?.id || `unconfigured:${category.id}`;
        if (!groups.has(key)) groups.set(key, { printerId: printer?.id || null, department, categoryIds: [], items: [] });
        groups.get(key)!.items.push(item);
        groups.get(key)!.categoryIds.push(category.id);
    }
    for (const [key, group] of groups) {
        const id = createHash('sha256').update(`${orderId}:${batch}:${key}`).digest('hex');
        const payload = JSON.stringify({ restaurantName: config?.header || 'ChoyxonaAzizxon', footer: config?.footer || '',
            department: group.department, categoryIds: [...new Set(group.categoryIds)], orderNumber: order.orderNumber,
            table: order.table ? `${order.table.room.name} / Stol ${order.table.number}` : 'Olib ketish',
            waiter: order.waiter?.fullName || 'Ofitsant', guestCount: order.guestCount,
            createdAt: new Date().toISOString(), notes: order.notes,
            items: group.items.map(item => ({ name: item.menuItem.name, quantity: `${item.quantity} ${item.menuItem.unit}`, notes: item.notes })) });
        await tx.printJob.upsert({ where: { id }, create: { id, orderId, printerId: group.printerId, payload, jobType: 'KITCHEN' }, update: {} });
    }
}
