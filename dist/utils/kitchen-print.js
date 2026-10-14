"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueKitchenPrint = queueKitchenPrint;
exports.queueKitchenReturnPrint = queueKitchenReturnPrint;
const crypto_1 = require("crypto");
async function queueKitchenPrint(tx, orderId, batch, itemIds) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: {
            table: { include: { room: true } }, waiter: { select: { fullName: true } },
            items: { where: itemIds ? { id: { in: itemIds } } : {}, include: { menuItem: { include: { category: true } } } }
        } });
    const [printers, config] = await Promise.all([
        tx.printer.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
        tx.printConfig.findUnique({ where: { id: 'default' } })
    ]);
    if (config?.autoPrint === false)
        return;
    const groups = new Map();
    for (const item of order.items) {
        const category = item.menuItem.category;
        const defaults = { Kaboblar: 'Kabobxona', Baliqlar: 'Baliqxona', 'Fast Food': 'Fastfood', Fastfood: 'Fastfood' };
        const department = item.menuItem.kitchenSection || defaults[category.name] || 'Umumiy Oshxona';
        const printer = printers.find(p => p.categoryIds.includes(category.id)) || printers.find(p => !p.categoryIds.length && p.department === department);
        const key = printer?.id || `unconfigured:${category.id}`;
        if (!groups.has(key))
            groups.set(key, { printerId: printer?.id || null, department, categoryIds: [], items: [] });
        groups.get(key).items.push(item);
        groups.get(key).categoryIds.push(category.id);
    }
    for (const [key, group] of groups) {
        const id = (0, crypto_1.createHash)('sha256').update(`${orderId}:${batch}:${key}`).digest('hex');
        const payload = JSON.stringify({ restaurantName: config?.header || 'ChoyxonaAzizxon', footer: config?.footer || '',
            department: group.department, categoryIds: [...new Set(group.categoryIds)], orderNumber: order.orderNumber,
            table: order.table ? `${order.table.room.name} / Stol ${order.table.number}` : 'Olib ketish',
            waiter: order.waiter?.fullName || 'Ofitsant', guestCount: order.guestCount,
            createdAt: new Date().toISOString(), notes: order.notes,
            items: group.items.map(item => ({ name: item.menuItem.name, quantity: `${item.quantity} ${item.menuItem.unit}`, notes: item.notes })) });
        await tx.printJob.upsert({ where: { id }, create: { id, orderId, printerId: group.printerId, payload, jobType: 'KITCHEN' }, update: {} });
    }
}
async function queueKitchenReturnPrint(tx, orderId, batch, itemId, quantity, reason, waiter) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: {
            table: { include: { room: true } }, waiter: { select: { fullName: true } },
            items: { where: { id: itemId }, include: { menuItem: { include: { category: true } } } }
        } });
    const [printers, config] = await Promise.all([
        tx.printer.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
        tx.printConfig.findUnique({ where: { id: 'default' } })
    ]);
    if (config?.autoPrint === false)
        return;
    const item = order.items[0];
    if (!item)
        return;
    const category = item.menuItem.category;
    const defaults = { Kaboblar: 'Kabobxona', Baliqlar: 'Baliqxona', 'Fast Food': 'Fastfood', Fastfood: 'Fastfood' };
    const department = item.menuItem.kitchenSection || defaults[category.name] || 'Umumiy Oshxona';
    const printer = printers.find(entry => entry.categoryIds.includes(category.id)) || printers.find(entry => !entry.categoryIds.length && entry.department === department);
    const id = (0, crypto_1.createHash)('sha256').update(`${orderId}:${batch}:${printer?.id || category.id}`).digest('hex');
    const payload = JSON.stringify({ restaurantName: config?.header || 'ChoyxonaAzizxon', footer: config?.footer || '',
        department, categoryIds: [category.id], orderNumber: order.orderNumber,
        table: order.table ? `${order.table.room.name} / Stol ${order.table.number}` : 'Olib ketish',
        waiter: order.waiter?.fullName || waiter, guestCount: order.guestCount, createdAt: new Date().toISOString(),
        returnAlert: true, notes: `!!! QAYTARILDI !!!\nSabab: ${reason}\nOfitsant: ${waiter}`,
        items: [{ name: item.menuItem.name, quantity: '', returnedQuantity: quantity, notes: '' }] });
    await tx.printJob.upsert({ where: { id }, create: { id, orderId, printerId: printer?.id || null, payload, jobType: 'KITCHEN' }, update: {} });
}
