import { RoleType } from '@prisma/client';
import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { prisma } from '../utils/db';

const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));

const PERMISSIONS = [
  { key: 'cashier.view_net_profit', role: RoleType.CASHIER, label: 'Kassir sof foydani ko\'ra olsin' },
  { key: 'waiter.edit_menu_prices', role: RoleType.WAITER, label: 'Ofitsiant menyu narxlarini o\'zgartira olsin' }
] as const;

router.get('/role-permissions', async (_req, res) => {
  try {
    const existing = await prisma.rolePermission.findMany();
    const map = new Map<string, boolean>();
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
  } catch (error) {
    console.error('Failed to fetch role permissions:', error);
    res.status(500).json({ success: false, message: 'Rol huquqlarini yuklab bo\'lmadi' });
  }
});

router.put('/role-permissions/:role/:permissionKey', async (req, res) => {
  const role = req.params.role as RoleType;
  const permissionKey = req.params.permissionKey;
  const enabled = Boolean(req.body?.enabled);

  if (!Object.values(RoleType).includes(role) || !PERMISSIONS.find(p => p.role === role && p.key === permissionKey)) {
    res.status(400).json({ success: false, message: 'Noto\'g\'ri parametr' });
    return;
  }

  try {
    await prisma.rolePermission.upsert({
      where: { role_permissionKey: { role, permissionKey } },
      create: { role, permissionKey, enabled },
      update: { enabled }
    });
    res.json({ success: true, message: 'Rol huquqi yangilandi.' });
  } catch (error) {
    console.error('Failed to update role permission:', error);
    res.status(500).json({ success: false, message: 'Rol huquqini yangilab bo\'lmadi' });
  }
});

export default router;
