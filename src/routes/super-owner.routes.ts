import { Router, Request, Response } from 'express';
import { loginSuperOwner } from '../services/super-owner-auth.service';
import { requireSuperOwner } from '../middleware/super-owner.middleware';
import { 
    getAllTenants, 
    getTenantById, 
    registerNewTenant, 
    approveTenant, 
    rejectTenant, 
    setTenantLock, 
    extendTenantSubscription, 
    generateTenantLicenseKey 
} from '../services/tenant.service';
import { 
    requestDeviceAccess, 
    approveDevice, 
    rejectDevice, 
    blockDevice, 
    checkDeviceAuthorization 
} from '../services/device.service';
import { 
    getTenantPermissions, 
    updateTenantPermissions 
} from '../services/permission.service';
import { 
    getTelegramConfig, 
    updateTelegramConfig, 
    sendDeviceApprovalRequest, 
    sendRegistrationNotification 
} from '../services/telegram-control.service';
import { prisma } from '../utils/db';

const router = Router();

// ==========================================
// 1. PUBLIC AUTH & DEVICE HANDSHAKE
// ==========================================

router.post('/super-owner/login', async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        const result = await loginSuperOwner(username, password);
        if (!result.success) {
            return res.status(401).json(result);
        }

        res.setHeader('Set-Cookie', [
            `super_owner_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`
        ]);

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'Server xatosi' });
    }
});

router.post('/super-owner/logout', (_req, res) => {
    res.setHeader('Set-Cookie', [
        `super_owner_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    ]);
    res.json({ success: true, message: 'Chiqildi' });
});

// Client device handshake
router.post('/devices/register', async (req: Request, res: Response) => {
    try {
        const { tenantId, deviceId, deviceName, deviceType, role, fingerprint } = req.body;
        if (!tenantId || !deviceId) {
            return res.status(400).json({ success: false, message: 'tenantId va deviceId kiritilishi shart' });
        }

        const device = await requestDeviceAccess({
            tenantId,
            deviceId,
            deviceName: deviceName || 'Noma’lum qurilma',
            deviceType,
            role,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            fingerprint
        });

        // Notify Telegram if new pending device
        if (device.status === 'PENDING') {
            sendDeviceApprovalRequest(device.id).catch(() => {});
        }

        res.json({
            success: true,
            status: device.status,
            device: {
                id: device.id,
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                status: device.status,
                token: device.token
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'Qurilma so‘rovi yuborilmadi' });
    }
});

router.get('/devices/status', async (req: Request, res: Response) => {
    try {
        const tenantId = (req.query.tenantId as string) || 'choyxona-azizxon-default-tenant';
        const deviceId = req.query.deviceId as string;
        const token = (req.query.token as string) || (req.headers['x-device-token'] as string);

        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'deviceId kerak' });
        }

        const check = await checkDeviceAuthorization(tenantId, deviceId, token);
        res.json({
            success: true,
            ...check
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

// ==========================================
// 2. PROTECTED SUPER OWNER CONTROLLERS
// ==========================================

router.use('/super-owner', requireSuperOwner);

router.get('/super-owner/dashboard', async (_req, res) => {
    try {
        const [
            tenants,
            pendingTenants,
            pendingDevices,
            approvedDevices,
            paymentsTotal
        ] = await Promise.all([
            prisma.tenant.count(),
            prisma.tenant.count({ where: { status: 'PENDING_APPROVAL' } }),
            prisma.deviceAuthorization.count({ where: { status: 'PENDING' } }),
            prisma.deviceAuthorization.count({ where: { status: 'APPROVED' } }),
            prisma.tenantPayment.aggregate({ _sum: { amount: true } })
        ]);

        const recentTenants = await prisma.tenant.findMany({
            take: 6,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { devices: true } } }
        });

        const recentPendingDevices = await prisma.deviceAuthorization.findMany({
            where: { status: 'PENDING' },
            take: 6,
            orderBy: { requestedAt: 'desc' },
            include: { tenant: { select: { name: true } } }
        });

        res.json({
            success: true,
            metrics: {
                totalTenants: tenants,
                pendingTenants,
                pendingDevices,
                approvedDevices,
                totalRevenue: paymentsTotal._sum.amount || 0
            },
            recentTenants,
            recentPendingDevices
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

// ----------------- TENANTS (RESTAURANTS) -----------------

router.get('/super-owner/tenants', async (_req, res) => {
    try {
        const tenants = await getAllTenants();
        res.json({ success: true, data: tenants });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants', async (req, res) => {
    try {
        const tenant = await registerNewTenant(req.body);
        sendRegistrationNotification(tenant.id).catch(() => {});
        res.json({ success: true, data: tenant });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.get('/super-owner/tenants/:id', async (req, res) => {
    try {
        const tenant = await getTenantById(req.params.id);
        if (!tenant) return res.status(404).json({ success: false, message: 'Restoran topilmadi' });
        res.json({ success: true, data: tenant });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants/:id/approve', async (req, res) => {
    try {
        const days = parseInt(req.body.initialDays || 30, 10);
        const updated = await approveTenant(req.params.id, req.superOwner?.id, days);
        res.json({ success: true, message: 'Restoran faollashtirildi!', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants/:id/reject', async (req, res) => {
    try {
        const updated = await rejectTenant(req.params.id, req.body.reason, req.superOwner?.id);
        res.json({ success: true, message: 'Restoran rad etildi', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants/:id/lock', async (req, res) => {
    try {
        const { lock, reason } = req.body;
        const updated = await setTenantLock(req.params.id, Boolean(lock), reason, req.superOwner?.id);
        res.json({
            success: true,
            message: lock ? 'Restoran tizimi qulflandi' : 'Restoran tizimi qulfdan chiqarildi',
            data: updated
        });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants/:id/extend', async (req, res) => {
    try {
        const days = parseInt(req.body.days, 10);
        const amount = Number(req.body.amount || 0);
        const notes = req.body.notes || '';
        const updated = await extendTenantSubscription(req.params.id, days, amount, notes, req.superOwner?.id);
        res.json({ success: true, message: `Obuna +${days} kunga uzaytirildi!`, data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.get('/super-owner/tenants/:id/permissions', async (req, res) => {
    try {
        const permissions = await getTenantPermissions(req.params.id);
        res.json({ success: true, data: permissions });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

router.put('/super-owner/tenants/:id/permissions', async (req, res) => {
    try {
        const updated = await updateTenantPermissions(req.params.id, req.body, req.superOwner?.id);
        res.json({ success: true, message: 'Panel ruxsatlari yangilandi!', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/tenants/:id/license-key', async (req, res) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
        if (!tenant) return res.status(404).json({ success: false, message: 'Restoran topilmadi' });
        const days = parseInt(req.body.days || 30, 10);
        const key = generateTenantLicenseKey(tenant.slug, days);
        res.json({ success: true, licenseKey: key, days, slug: tenant.slug });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

// ----------------- DEVICES (QURILMALAR) -----------------

router.get('/super-owner/devices', async (req, res) => {
    try {
        const status = req.query.status as string;
        const tenantId = req.query.tenantId as string;

        const where: any = {};
        if (status) where.status = status;
        if (tenantId) where.tenantId = tenantId;

        const devices = await prisma.deviceAuthorization.findMany({
            where,
            orderBy: { requestedAt: 'desc' },
            include: { tenant: { select: { id: true, name: true, slug: true } } }
        });
        res.json({ success: true, data: devices });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/devices/:id/approve', async (req, res) => {
    try {
        const updated = await approveDevice(req.params.id, req.superOwner?.id);
        res.json({ success: true, message: 'Qurilmaga muvaffaqiyatli ruxsat berildi!', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/devices/:id/reject', async (req, res) => {
    try {
        const updated = await rejectDevice(req.params.id, req.body.reason, req.superOwner?.id);
        res.json({ success: true, message: 'Qurilma rad etildi', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.post('/super-owner/devices/:id/block', async (req, res) => {
    try {
        const updated = await blockDevice(req.params.id, req.body.reason, req.superOwner?.id);
        res.json({ success: true, message: 'Qurilma bloklandi', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

// ----------------- TELEGRAM & AUDIT -----------------

router.get('/super-owner/telegram/config', async (_req, res) => {
    try {
        const config = await getTelegramConfig();
        res.json({ success: true, data: config });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

router.put('/super-owner/telegram/config', async (req, res) => {
    try {
        const updated = await updateTelegramConfig(req.body);
        res.json({ success: true, message: 'Telegram sozlamalari saqlandi!', data: updated });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error?.message });
    }
});

router.get('/super-owner/audit', async (req, res) => {
    try {
        const logs = await prisma.ownerAuditLog.findMany({
            take: 100,
            orderBy: { createdAt: 'desc' },
            include: {
                tenant: { select: { name: true } },
                superOwner: { select: { fullName: true } }
            }
        });
        res.json({ success: true, data: logs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message });
    }
});

export default router;

