"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../utils/db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
const PERMISSIONS = [
    { key: 'cashier.view_net_profit', role: client_1.RoleType.CASHIER, label: 'Kassir sof foydani ko\'ra olsin' },
    { key: 'waiter.edit_menu_prices', role: client_1.RoleType.WAITER, label: 'Ofitsiant menyu narxlarini o\'zgartira olsin' }
];
router.get('/role-permissions', async (_req, res) => {
    try {
        const existing = await db_1.prisma.rolePermission.findMany();
        const map = new Map();
        for (const e of existing) {
            map.set(`${e.role}:${e.permissionKey}`, e.enabled);
        }
        const data = PERMISSIONS.map(p => ({
            role: p.role,
            permissionKey: p.key,
            label: p.label,
            enabled: map.get(`${p.role}:${p.key}`) ?? false
        }));
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('Failed to fetch role permissions:', error);
        res.status(500).json({ success: false, message: 'Rol huquqlarini yuklab bo\'lmadi' });
    }
});
router.put('/role-permissions/:role/:permissionKey', async (req, res) => {
    const role = req.params.role;
    const permissionKey = req.params.permissionKey;
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean' || !Object.values(client_1.RoleType).includes(role) || !PERMISSIONS.find(p => p.role === role && p.key === permissionKey)) {
        res.status(400).json({ success: false, message: 'Noto\'g\'ri parametr' });
        return;
    }
    try {
        await db_1.prisma.$transaction(async (tx) => {
            const old = await tx.rolePermission.findUnique({ where: { role_permissionKey: { role, permissionKey } } });
            await tx.rolePermission.upsert({
                where: { role_permissionKey: { role, permissionKey } },
                create: { role, permissionKey, enabled },
                update: { enabled }
            });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'ROLE_PERMISSION_UPDATED', entity: 'RolePermission', entityId: `${role}:${permissionKey}`, oldValue: JSON.stringify({ enabled: old?.enabled ?? false }), newValue: JSON.stringify({ enabled }) } });
        });
        res.json({ success: true, message: 'Rol huquqi yangilandi.' });
    }
    catch (error) {
        console.error('Failed to update role permission:', error);
        res.status(500).json({ success: false, message: 'Rol huquqini yangilab bo\'lmadi' });
    }
});
exports.default = router;
