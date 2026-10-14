import { Request, Response, NextFunction } from 'express';
import { checkDeviceAuthorization, requestDeviceAccess } from '../services/device.service';
import { sendDeviceApprovalRequest } from '../services/telegram-control.service';
import { DeviceType, RoleType } from '@prisma/client';

export async function deviceGuard(req: Request, res: Response, next: NextFunction) {
    const path = req.path;

    // Skip device check for Super Owner, Owner, and Device Handshake endpoints
    if (
        path.startsWith('/api/super-owner') ||
        path.startsWith('/super-owner') ||
        path.startsWith('/api/owner') ||
        path.startsWith('/owner') ||
        path.startsWith('/api/devices') ||
        path.startsWith('/api/subscription') ||
        path.startsWith('/js/') ||
        path.startsWith('/css/') ||
        path.startsWith('/images/') ||
        path.startsWith('/assets/') ||
        path === '/favicon.ico' ||
        path === '/favicon.svg'
    ) {
        return next();
    }

    const deviceId = req.headers['x-device-id'] as string;
    const deviceToken = req.headers['x-device-token'] as string;
    const deviceName = (req.headers['x-device-name'] as string) || 'Noma’lum qurilma';
    const tenantId = (req.headers['x-tenant-id'] as string) || 'choyxona-azizxon-default-tenant';

    // If no device ID header provided, check if client cookie or query has it
    if (!deviceId) {
        return next(); // Allows initial page HTML load to inject device-agent.js
    }

    try {
        const check = await checkDeviceAuthorization(tenantId, deviceId, deviceToken);

        if (!check.authorized) {
            // If device record doesn't exist or is pending, send Telegram notification once
            if (check.status === 'PENDING') {
                try {
                    const dev = await requestDeviceAccess({
                        tenantId,
                        deviceId,
                        deviceName,
                        deviceType: DeviceType.PC,
                        role: RoleType.WAITER,
                        ipAddress: req.ip || req.socket.remoteAddress,
                        userAgent: req.headers['user-agent']
                    });
                    sendDeviceApprovalRequest(dev.id).catch(() => {});
                } catch {}
            }

            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    code: 'DEVICE_UNAUTHORIZED',
                    status: check.status,
                    message: check.status === 'BLOCKED'
                        ? 'Ushbu qurilma xavfsizlik sababli bloklangan.'
                        : check.status === 'REJECTED'
                        ? 'Qurilma ulanishi Super Owner tomonidan rad etilgan.'
                        : 'Ushbu qurilmaga Super Owner tomonidan ruxsat berilishi kutilmoqda.',
                    deviceId,
                    deviceName
                });
            }
        }

        (req as any).authorizedDevice = check.device;
        next();
    } catch (error) {
        console.error('[DeviceGuard] Xatolik:', error);
        next();
    }
}

