import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';
import { createHmac, randomBytes } from 'crypto';
import { RoleType, DeviceType, DeviceStatus } from '@prisma/client';

const DEVICE_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_device_secret_2026';

export function generateDeviceToken(deviceId: string, tenantId: string): string {
    const payload = `${deviceId}:${tenantId}:${Date.now()}`;
    const sig = createHmac('sha256', DEVICE_SECRET).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyDeviceSignature(token: string): { deviceId: string; tenantId: string } | null {
    if (!token) return null;
    const [payloadBase, sig] = token.split('.');
    if (!payloadBase || !sig) return null;

    const payload = Buffer.from(payloadBase, 'base64url').toString('utf8');
    const expectedSig = createHmac('sha256', DEVICE_SECRET).update(payload).digest('hex');
    if (sig !== expectedSig) return null;

    const [deviceId, tenantId] = payload.split(':');
    return { deviceId, tenantId };
}

export async function requestDeviceAccess(data: {
    tenantId: string;
    deviceId: string;
    deviceName: string;
    deviceType?: DeviceType;
    role?: RoleType;
    ipAddress?: string;
    userAgent?: string;
    fingerprint?: string;
}) {
    const tenant = await prisma.tenant.findUnique({ where: { id: data.tenantId } });
    if (!tenant) throw new Error('Restoran topilmadi');

    let device = await prisma.deviceAuthorization.findUnique({
        where: {
            tenantId_deviceId: {
                tenantId: data.tenantId,
                deviceId: data.deviceId
            }
        }
    });

    if (!device) {
        device = await prisma.deviceAuthorization.create({
            data: {
                tenantId: data.tenantId,
                deviceId: data.deviceId,
                deviceName: data.deviceName || 'Noma’lum qurilma',
                deviceType: data.deviceType || DeviceType.PC,
                role: data.role || RoleType.WAITER,
                status: DeviceStatus.PENDING,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                fingerprint: data.fingerprint,
                isOnline: true,
                lastSeenAt: new Date()
            }
        });
    } else {
        // If device was previously rejected or revoked, set to pending again
        if (device.status === DeviceStatus.REJECTED || device.status === DeviceStatus.REVOKED) {
            device = await prisma.deviceAuthorization.update({
                where: { id: device.id },
                data: {
                    status: DeviceStatus.PENDING,
                    deviceName: data.deviceName || device.deviceName,
                    ipAddress: data.ipAddress,
                    userAgent: data.userAgent,
                    isOnline: true,
                    lastSeenAt: new Date()
                }
            });
        } else {
            device = await prisma.deviceAuthorization.update({
                where: { id: device.id },
                data: {
                    isOnline: true,
                    lastSeenAt: new Date(),
                    ipAddress: data.ipAddress || device.ipAddress
                }
            });
        }
    }

    // Broadcast to Owner in real-time
    emitSocketEvent('owner_device_request', {
        id: device.id,
        tenantName: tenant.name,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        role: device.role,
        status: device.status,
        ipAddress: device.ipAddress,
        requestedAt: device.requestedAt
    });

    return device;
}

export async function approveDevice(deviceIdOrRowId: string, superOwnerId?: string) {
    const device = await prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        },
        include: { tenant: true }
    });
    if (!device) throw new Error('Qurilma topilmadi');

    const token = generateDeviceToken(device.deviceId, device.tenantId);

    const updated = await prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: DeviceStatus.APPROVED,
            token,
            approvedAt: new Date(),
            approvedById: superOwnerId,
            rejectionReason: null,
            blockedReason: null
        }
    });

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId: device.tenantId,
            action: 'DEVICE_APPROVED',
            entity: 'DeviceAuthorization',
            entityId: device.id,
            details: { deviceName: device.deviceName, role: device.role, tenantName: device.tenant.name }
        }
    });

    // Notify connected device immediately via socket so it unlocks in real-time
    emitSocketEvent(`device_authorized_${device.deviceId}`, {
        status: DeviceStatus.APPROVED,
        token
    });

    emitSocketEvent('device_status_changed', {
        id: device.id,
        deviceId: device.deviceId,
        status: DeviceStatus.APPROVED
    });

    return updated;
}

export async function rejectDevice(deviceIdOrRowId: string, reason: string, superOwnerId?: string) {
    const device = await prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        }
    });
    if (!device) throw new Error('Qurilma topilmadi');

    const updated = await prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: DeviceStatus.REJECTED,
            token: null,
            rejectionReason: reason || 'Super Owner tomonidan rad etildi'
        }
    });

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId: device.tenantId,
            action: 'DEVICE_REJECTED',
            entity: 'DeviceAuthorization',
            entityId: device.id,
            details: { reason }
        }
    });

    emitSocketEvent(`device_authorized_${device.deviceId}`, {
        status: DeviceStatus.REJECTED,
        reason
    });

    return updated;
}

export async function blockDevice(deviceIdOrRowId: string, reason: string, superOwnerId?: string) {
    const device = await prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        }
    });
    if (!device) throw new Error('Qurilma topilmadi');

    const updated = await prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: DeviceStatus.BLOCKED,
            token: null,
            blockedReason: reason || 'Xavfsizlik sababli bloklangan'
        }
    });

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId: device.tenantId,
            action: 'DEVICE_BLOCKED',
            entity: 'DeviceAuthorization',
            entityId: device.id,
            details: { reason }
        }
    });

    emitSocketEvent(`device_authorized_${device.deviceId}`, {
        status: DeviceStatus.BLOCKED,
        reason
    });

    return updated;
}

export async function checkDeviceAuthorization(tenantId: string, deviceId: string, token?: string) {
    if (!deviceId) return { authorized: false, status: DeviceStatus.PENDING };

    const device = await prisma.deviceAuthorization.findUnique({
        where: {
            tenantId_deviceId: { tenantId, deviceId }
        }
    });

    if (!device) {
        return { authorized: false, status: DeviceStatus.PENDING };
    }

    if (device.status === DeviceStatus.APPROVED) {
        // If token provided, verify it
        if (token && device.token && token !== device.token) {
            return { authorized: false, status: DeviceStatus.REVOKED, device };
        }
        return { authorized: true, status: DeviceStatus.APPROVED, device };
    }

    return {
        authorized: false,
        status: device.status,
        reason: device.blockedReason || device.rejectionReason,
        device
    };
}

