"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPermissions = void 0;
exports.getTenantPermissions = getTenantPermissions;
exports.updateTenantPermissions = updateTenantPermissions;
exports.isFeatureEnabled = isFeatureEnabled;
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
exports.defaultPermissions = {
    admin: {
        reports: true,
        inventory: true,
        finance: true,
        employees: true,
        deleteOrder: true,
        customDiscount: true,
        settings: true,
        attendance: true
    },
    cashier: {
        discounts: true,
        refunds: true,
        debts: true,
        splitPayments: true,
        cancelItems: true,
        shiftControl: true
    },
    waiter: {
        tableTransfer: true,
        cancelDish: false,
        takePayment: false,
        callService: true,
        takeaway: true
    },
    kitchen: {
        tvDisplay: true,
        soundAlerts: true,
        fishSection: true,
        fastFoodSection: true,
        manualStatusUpdate: true
    },
    warehouse: {
        stockAlerts: true,
        manualAdjustment: true,
        purchaseCosts: true
    },
    customer: {
        webMenu: true,
        onlineOrder: true,
        feedback: true,
        qrCall: true
    }
};
async function getTenantPermissions(tenantId) {
    const tenant = await db_1.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { panelPermissions: true }
    });
    if (!tenant || !tenant.panelPermissions || typeof tenant.panelPermissions !== 'object') {
        return exports.defaultPermissions;
    }
    const saved = tenant.panelPermissions;
    return {
        admin: { ...exports.defaultPermissions.admin, ...(saved.admin || {}) },
        cashier: { ...exports.defaultPermissions.cashier, ...(saved.cashier || {}) },
        waiter: { ...exports.defaultPermissions.waiter, ...(saved.waiter || {}) },
        kitchen: { ...exports.defaultPermissions.kitchen, ...(saved.kitchen || {}) },
        warehouse: { ...exports.defaultPermissions.warehouse, ...(saved.warehouse || {}) },
        customer: { ...exports.defaultPermissions.customer, ...(saved.customer || {}) }
    };
}
async function updateTenantPermissions(tenantId, permissions, superOwnerId) {
    const current = await getTenantPermissions(tenantId);
    const merged = {
        admin: { ...current.admin, ...(permissions.admin || {}) },
        cashier: { ...current.cashier, ...(permissions.cashier || {}) },
        waiter: { ...current.waiter, ...(permissions.waiter || {}) },
        kitchen: { ...current.kitchen, ...(permissions.kitchen || {}) },
        warehouse: { ...current.warehouse, ...(permissions.warehouse || {}) },
        customer: { ...current.customer, ...(permissions.customer || {}) }
    };
    const updated = await db_1.prisma.tenant.update({
        where: { id: tenantId },
        data: {
            panelPermissions: merged
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'PERMISSIONS_UPDATED',
            entity: 'Tenant',
            entityId: tenantId,
            details: merged
        }
    });
    // Real-time broadcast to all client panels of this restaurant to update UI toggles immediately
    (0, socket_1.emitSocketEvent)('permissions_updated', {
        tenantId,
        permissions: merged
    });
    return merged;
}
async function isFeatureEnabled(tenantId, panel, feature) {
    const perms = await getTenantPermissions(tenantId);
    const panelConfig = perms[panel];
    if (!panelConfig)
        return true;
    return panelConfig[feature] !== false;
}
