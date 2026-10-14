"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDeviceToken = generateDeviceToken;
exports.verifyDeviceSignature = verifyDeviceSignature;
exports.requestDeviceAccess = requestDeviceAccess;
exports.approveDevice = approveDevice;
exports.rejectDevice = rejectDevice;
exports.blockDevice = blockDevice;
exports.checkDeviceAuthorization = checkDeviceAuthorization;
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const DEVICE_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_device_secret_2026';
function generateDeviceToken(deviceId, tenantId) {
    const payload = `${deviceId}:${tenantId}:${Date.now()}`;
    const sig = (0, crypto_1.createHmac)('sha256', DEVICE_SECRET).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}
function verifyDeviceSignature(token) {
    if (!token)
        return null;
    const [payloadBase, sig] = token.split('.');
    if (!payloadBase || !sig)
        return null;
    const payload = Buffer.from(payloadBase, 'base64url').toString('utf8');
    const expectedSig = (0, crypto_1.createHmac)('sha256', DEVICE_SECRET).update(payload).digest('hex');
    if (sig !== expectedSig)
        return null;
    const [deviceId, tenantId] = payload.split(':');
    return { deviceId, tenantId };
}
async function requestDeviceAccess(data) {
    const tenant = await db_1.prisma.tenant.findUnique({ where: { id: data.tenantId } });
    if (!tenant)
        throw new Error('Restoran topilmadi');
    let device = await db_1.prisma.deviceAuthorization.findUnique({
        where: {
            tenantId_deviceId: {
                tenantId: data.tenantId,
                deviceId: data.deviceId
            }
        }
    });
    if (!device) {
        device = await db_1.prisma.deviceAuthorization.create({
            data: {
                tenantId: data.tenantId,
                deviceId: data.deviceId,
                deviceName: data.deviceName || 'Noma’lum qurilma',
                deviceType: data.deviceType || client_1.DeviceType.PC,
                role: data.role || client_1.RoleType.WAITER,
                status: client_1.DeviceStatus.PENDING,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                fingerprint: data.fingerprint,
                isOnline: true,
                lastSeenAt: new Date()
            }
        });
    }
    else {
        // If device was previously rejected or revoked, set to pending again
        if (device.status === client_1.DeviceStatus.REJECTED || device.status === client_1.DeviceStatus.REVOKED) {
            device = await db_1.prisma.deviceAuthorization.update({
                where: { id: device.id },
                data: {
                    status: client_1.DeviceStatus.PENDING,
                    deviceName: data.deviceName || device.deviceName,
                    ipAddress: data.ipAddress,
                    userAgent: data.userAgent,
                    isOnline: true,
                    lastSeenAt: new Date()
                }
            });
        }
        else {
            device = await db_1.prisma.deviceAuthorization.update({
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
    (0, socket_1.emitSocketEvent)('owner_device_request', {
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
async function approveDevice(deviceIdOrRowId, superOwnerId) {
    const device = await db_1.prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        },
        include: { tenant: true }
    });
    if (!device)
        throw new Error('Qurilma topilmadi');
    const token = generateDeviceToken(device.deviceId, device.tenantId);
    const updated = await db_1.prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: client_1.DeviceStatus.APPROVED,
            token,
            approvedAt: new Date(),
            approvedById: superOwnerId,
            rejectionReason: null,
            blockedReason: null
        }
    });
    await db_1.prisma.ownerAuditLog.create({
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
    (0, socket_1.emitSocketEvent)(`device_authorized_${device.deviceId}`, {
        status: client_1.DeviceStatus.APPROVED,
        token
    });
    (0, socket_1.emitSocketEvent)('device_status_changed', {
        id: device.id,
        deviceId: device.deviceId,
        status: client_1.DeviceStatus.APPROVED
    });
    return updated;
}
async function rejectDevice(deviceIdOrRowId, reason, superOwnerId) {
    const device = await db_1.prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        }
    });
    if (!device)
        throw new Error('Qurilma topilmadi');
    const updated = await db_1.prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: client_1.DeviceStatus.REJECTED,
            token: null,
            rejectionReason: reason || 'Super Owner tomonidan rad etildi'
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId: device.tenantId,
            action: 'DEVICE_REJECTED',
            entity: 'DeviceAuthorization',
            entityId: device.id,
            details: { reason }
        }
    });
    (0, socket_1.emitSocketEvent)(`device_authorized_${device.deviceId}`, {
        status: client_1.DeviceStatus.REJECTED,
        reason
    });
    return updated;
}
async function blockDevice(deviceIdOrRowId, reason, superOwnerId) {
    const device = await db_1.prisma.deviceAuthorization.findFirst({
        where: {
            OR: [
                { id: deviceIdOrRowId },
                { deviceId: deviceIdOrRowId }
            ]
        }
    });
    if (!device)
        throw new Error('Qurilma topilmadi');
    const updated = await db_1.prisma.deviceAuthorization.update({
        where: { id: device.id },
        data: {
            status: client_1.DeviceStatus.BLOCKED,
            token: null,
            blockedReason: reason || 'Xavfsizlik sababli bloklangan'
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId: device.tenantId,
            action: 'DEVICE_BLOCKED',
            entity: 'DeviceAuthorization',
            entityId: device.id,
            details: { reason }
        }
    });
    (0, socket_1.emitSocketEvent)(`device_authorized_${device.deviceId}`, {
        status: client_1.DeviceStatus.BLOCKED,
        reason
    });
    return updated;
}
async function checkDeviceAuthorization(tenantId, deviceId, token) {
    if (!deviceId)
        return { authorized: false, status: client_1.DeviceStatus.PENDING };
    const device = await db_1.prisma.deviceAuthorization.findUnique({
        where: {
            tenantId_deviceId: { tenantId, deviceId }
        }
    });
    if (!device) {
        return { authorized: false, status: client_1.DeviceStatus.PENDING };
    }
    if (device.status === client_1.DeviceStatus.APPROVED) {
        // If token provided, verify it
        if (token && device.token && token !== device.token) {
            return { authorized: false, status: client_1.DeviceStatus.REVOKED, device };
        }
        return { authorized: true, status: client_1.DeviceStatus.APPROVED, device };
    }
    return {
        authorized: false,
        status: device.status,
        reason: device.blockedReason || device.rejectionReason,
        device
    };
}
