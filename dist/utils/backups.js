"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupModels = void 0;
exports.backupSelect = backupSelect;
exports.businessSnapshot = businessSnapshot;
const client_1 = require("@prisma/client");
const settings_1 = require("./settings");
exports.backupModels = ['User', 'WaiterProfile', 'CashierProfile', 'WaiterShift', 'AttendanceConfig', 'Room', 'Table', 'MenuCategory', 'MenuItem', 'Recipe', 'InventoryProduct', 'InventoryTransaction', 'Purchase', 'PurchaseItem', 'Order', 'OrderItem', 'OrderStatusHistory', 'Payment', 'Customer', 'CustomerDebt', 'DebtPayment', 'Expense', 'Refund', 'RefundItem', 'CashSession', 'CashMovement', 'PackagingOption', 'OrderPackaging', 'Receipt', 'WaiterCall', 'Feedback', 'RestaurantSetting', 'RolePermission'];
function backupSelect(modelName) {
    const model = client_1.Prisma.dmmf.datamodel.models.find(m => m.name === modelName);
    if (!model || !exports.backupModels.includes(modelName))
        throw Error('INVALID_BACKUP_MODEL');
    return Object.fromEntries(model.fields.filter(f => f.kind !== 'object' && !/password|pin|token|secret|verification/i.test(f.name)).map(f => [f.name, true]));
}
async function businessSnapshot(tx) {
    const tables = {};
    for (const name of exports.backupModels) {
        const model = tx[name[0].toLowerCase() + name.slice(1)];
        const count = await model.count();
        if (count > 200000)
            throw Error('BACKUP_TOO_LARGE');
        tables[name] = await model.findMany({ select: backupSelect(name) });
    }
    const settings = Object.fromEntries(await Promise.all(Object.keys(settings_1.defaults).map(async (key) => [key, await (0, settings_1.getSettings)(tx, key)])));
    return { format: 'choyxona-business-v1', createdAt: new Date().toISOString(), settings, tables };
}
