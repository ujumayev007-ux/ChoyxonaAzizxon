import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';

export interface PanelPermissionsConfig {
    admin: {
        reports: boolean;
        inventory: boolean;
        finance: boolean;
        employees: boolean;
        deleteOrder: boolean;
        customDiscount: boolean;
        settings: boolean;
        attendance: boolean;
    };
    cashier: {
        discounts: boolean;
        refunds: boolean;
        debts: boolean;
        splitPayments: boolean;
        cancelItems: boolean;
        shiftControl: boolean;
    };
    waiter: {
        tableTransfer: boolean;
        cancelDish: boolean;
        takePayment: boolean;
        callService: boolean;
        takeaway: boolean;
    };
    kitchen: {
        tvDisplay: boolean;
        soundAlerts: boolean;
        fishSection: boolean;
        fastFoodSection: boolean;
        manualStatusUpdate: boolean;
    };
    warehouse: {
        stockAlerts: boolean;
        manualAdjustment: boolean;
        purchaseCosts: boolean;
    };
    customer: {
        webMenu: boolean;
        onlineOrder: boolean;
        feedback: boolean;
        qrCall: boolean;
    };
}

export const defaultPermissions: PanelPermissionsConfig = {
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

export async function getTenantPermissions(tenantId: string): Promise<PanelPermissionsConfig> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { panelPermissions: true }
    });

    if (!tenant || !tenant.panelPermissions || typeof tenant.panelPermissions !== 'object') {
        return defaultPermissions;
    }

    const saved = tenant.panelPermissions as Record<string, any>;
    return {
        admin: { ...defaultPermissions.admin, ...(saved.admin || {}) },
        cashier: { ...defaultPermissions.cashier, ...(saved.cashier || {}) },
        waiter: { ...defaultPermissions.waiter, ...(saved.waiter || {}) },
        kitchen: { ...defaultPermissions.kitchen, ...(saved.kitchen || {}) },
        warehouse: { ...defaultPermissions.warehouse, ...(saved.warehouse || {}) },
        customer: { ...defaultPermissions.customer, ...(saved.customer || {}) }
    };
}

export async function updateTenantPermissions(tenantId: string, permissions: Partial<PanelPermissionsConfig>, superOwnerId?: string) {
    const current = await getTenantPermissions(tenantId);
    const merged: PanelPermissionsConfig = {
        admin: { ...current.admin, ...(permissions.admin || {}) },
        cashier: { ...current.cashier, ...(permissions.cashier || {}) },
        waiter: { ...current.waiter, ...(permissions.waiter || {}) },
        kitchen: { ...current.kitchen, ...(permissions.kitchen || {}) },
        warehouse: { ...current.warehouse, ...(permissions.warehouse || {}) },
        customer: { ...current.customer, ...(permissions.customer || {}) }
    };

    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            panelPermissions: merged as any
        }
    });

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'PERMISSIONS_UPDATED',
            entity: 'Tenant',
            entityId: tenantId,
            details: merged as any
        }
    });

    // Real-time broadcast to all client panels of this restaurant to update UI toggles immediately
    emitSocketEvent('permissions_updated', {
        tenantId,
        permissions: merged
    });

    return merged;
}

export async function isFeatureEnabled(tenantId: string, panel: keyof PanelPermissionsConfig, feature: string): Promise<boolean> {
    const perms = await getTenantPermissions(tenantId);
    const panelConfig = (perms as any)[panel];
    if (!panelConfig) return true;
    return panelConfig[feature] !== false;
}

