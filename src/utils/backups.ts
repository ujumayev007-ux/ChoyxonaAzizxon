import { Prisma } from '@prisma/client';
import { defaults, getSettings, SettingKey } from './settings';
export const backupModels = ['User', 'WaiterProfile', 'CashierProfile', 'WaiterShift', 'AttendanceConfig', 'Room', 'Table', 'MenuCategory', 'MenuItem', 'Recipe', 'InventoryProduct', 'InventoryTransaction', 'Purchase', 'PurchaseItem', 'Order', 'OrderItem', 'OrderStatusHistory', 'Payment', 'Customer', 'CustomerDebt', 'DebtPayment', 'Expense', 'Refund', 'RefundItem', 'CashSession', 'CashMovement', 'PackagingOption', 'OrderPackaging', 'Receipt', 'WaiterCall', 'Feedback', 'RestaurantSetting', 'RolePermission'];
export function backupSelect(modelName: string) {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === modelName);
    if (!model || !backupModels.includes(modelName)) throw Error('INVALID_BACKUP_MODEL');
    return Object.fromEntries(model.fields.filter(f => f.kind !== 'object' && !/password|pin|token|secret|verification/i.test(f.name)).map(f => [f.name, true]));
}
export async function businessSnapshot(tx: Prisma.TransactionClient) {
    const tables: Record<string, unknown[]> = {};
    for (const name of backupModels) {
        const model = (tx as any)[name[0].toLowerCase() + name.slice(1)];
        const count = await model.count(); if (count > 200000) throw Error('BACKUP_TOO_LARGE');
        tables[name] = await model.findMany({ select: backupSelect(name) });
    }
    const settings = Object.fromEntries(await Promise.all((Object.keys(defaults) as SettingKey[]).map(async key => [key, await getSettings(tx, key)])));
    return { format: 'choyxona-business-v1', createdAt: new Date().toISOString(), settings, tables };
}
