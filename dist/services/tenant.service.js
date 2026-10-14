"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllTenants = getAllTenants;
exports.getTenantById = getTenantById;
exports.getTenantBySlug = getTenantBySlug;
exports.registerNewTenant = registerNewTenant;
exports.approveTenant = approveTenant;
exports.rejectTenant = rejectTenant;
exports.setTenantLock = setTenantLock;
exports.extendTenantSubscription = extendTenantSubscription;
exports.generateTenantLicenseKey = generateTenantLicenseKey;
exports.activateTenantLicenseKey = activateTenantLicenseKey;
const db_1 = require("../utils/db");
const socket_1 = require("../socket");
const crypto_1 = require("crypto");
const LICENSE_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_license_secret_2026';
async function getAllTenants() {
    return db_1.prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            _count: {
                select: {
                    devices: true,
                    payments: true
                }
            }
        }
    });
}
async function getTenantById(id) {
    return db_1.prisma.tenant.findUnique({
        where: { id },
        include: {
            devices: { orderBy: { requestedAt: 'desc' } },
            payments: { orderBy: { createdAt: 'desc' }, take: 50 },
            auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 }
        }
    });
}
async function getTenantBySlug(slug) {
    return db_1.prisma.tenant.findUnique({
        where: { slug }
    });
}
async function registerNewTenant(input) {
    const slug = input.slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
    const existing = await db_1.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
        throw new Error(`Ushbu identifikator (${slug}) bilan restoran allaqachon mavjud`);
    }
    const tenant = await db_1.prisma.tenant.create({
        data: {
            slug,
            name: input.name.trim(),
            ownerName: input.ownerName.trim(),
            ownerPhone: input.ownerPhone.trim(),
            address: input.address?.trim() || '',
            monthlyFee: input.monthlyFee || 500000,
            subscriptionPlan: input.subscriptionPlan || 'STANDART',
            status: 'PENDING_APPROVAL',
            statusReason: 'Yangi ro‘yxatdan o‘tdi. Super Owner tasdiqlashi kutilmoqda.',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days grace
            panelPermissions: {
                admin: { reports: true, inventory: true, finance: true, employees: true },
                cashier: { discounts: true, refunds: true, debts: true },
                waiter: { callService: true, takeaway: true },
                kitchen: { tvDisplay: true, fishSection: true }
            }
        }
    });
    (0, socket_1.emitSocketEvent)('owner_new_registration', {
        tenantId: tenant.id,
        name: tenant.name,
        ownerPhone: tenant.ownerPhone,
        requestedAt: tenant.createdAt
    });
    return tenant;
}
async function approveTenant(tenantId, superOwnerId, initialDays = 30) {
    const tenant = await db_1.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant)
        throw new Error('Restoran topilmadi');
    const periodEnd = new Date(Date.now() + initialDays * 24 * 60 * 60 * 1000);
    const updated = await db_1.prisma.tenant.update({
        where: { id: tenantId },
        data: {
            status: 'ACTIVE',
            statusReason: 'Super Owner tomonidan tasdiqlandi va faollashtirildi',
            isLocked: false,
            lockReason: null,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'RESTAURANT_APPROVED',
            entity: 'Tenant',
            entityId: tenantId,
            details: { name: tenant.name, initialDays, periodEnd }
        }
    });
    (0, socket_1.emitSocketEvent)('tenant_status_updated', {
        tenantId: updated.id,
        status: updated.status,
        currentPeriodEnd: updated.currentPeriodEnd
    });
    return updated;
}
async function rejectTenant(tenantId, reason, superOwnerId) {
    const updated = await db_1.prisma.tenant.update({
        where: { id: tenantId },
        data: {
            status: 'REJECTED',
            statusReason: reason || 'Super Owner tomonidan rad etildi',
            isLocked: true,
            lockReason: reason || 'Ro‘yxatdan o‘tish arizasi rad etilgan.'
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'RESTAURANT_REJECTED',
            entity: 'Tenant',
            entityId: tenantId,
            details: { reason }
        }
    });
    (0, socket_1.emitSocketEvent)('tenant_status_updated', {
        tenantId: updated.id,
        status: updated.status,
        lockReason: updated.lockReason
    });
    return updated;
}
async function setTenantLock(tenantId, lock, reason, superOwnerId) {
    const updated = await db_1.prisma.tenant.update({
        where: { id: tenantId },
        data: {
            isLocked: lock,
            lockReason: lock ? (reason || 'Dastur Super Owner tomonidan masofadan qulflangan.') : null,
            status: lock ? 'LOCKED' : 'ACTIVE'
        }
    });
    await db_1.prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: lock ? 'RESTAURANT_LOCKED' : 'RESTAURANT_UNLOCKED',
            entity: 'Tenant',
            entityId: tenantId,
            details: { reason }
        }
    });
    // Real-time broadcast: Immediately locks or unlocks all connected panels for this restaurant!
    (0, socket_1.emitSocketEvent)('tenant_lock_changed', {
        tenantId: updated.id,
        isLocked: updated.isLocked,
        lockReason: updated.lockReason,
        status: updated.status
    });
    return updated;
}
async function extendTenantSubscription(tenantId, days, amount = 0, notes = '', superOwnerId) {
    const tenant = await db_1.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant)
        throw new Error('Restoran topilmadi');
    const currentEnd = new Date(tenant.currentPeriodEnd).getTime();
    const baseTime = currentEnd > Date.now() ? currentEnd : Date.now();
    const newEnd = new Date(baseTime + days * 24 * 60 * 60 * 1000);
    const paymentAmount = amount || (Number(tenant.monthlyFee) / 30) * days;
    const [updatedTenant] = await db_1.prisma.$transaction([
        db_1.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                currentPeriodEnd: newEnd,
                status: 'ACTIVE',
                isLocked: false,
                lockReason: null
            }
        }),
        db_1.prisma.tenantPayment.create({
            data: {
                tenantId,
                amount: paymentAmount,
                currency: 'UZS',
                periodStart: new Date(baseTime),
                periodEnd: newEnd,
                status: 'TOLANDI',
                notes: notes || `+${days} kunlik obuna uzaytirildi`,
                confirmedById: superOwnerId
            }
        }),
        db_1.prisma.ownerAuditLog.create({
            data: {
                superOwnerId,
                tenantId,
                action: 'SUBSCRIPTION_EXTENDED',
                entity: 'TenantPayment',
                details: { days, paymentAmount, newEnd }
            }
        })
    ]);
    (0, socket_1.emitSocketEvent)('tenant_status_updated', {
        tenantId: updatedTenant.id,
        status: updatedTenant.status,
        currentPeriodEnd: updatedTenant.currentPeriodEnd
    });
    return updatedTenant;
}
function generateTenantLicenseKey(slug, days) {
    const salt = (0, crypto_1.randomBytes)(2).toString('hex').toUpperCase();
    const payload = `${slug.toUpperCase()}-${days}-${salt}`;
    const sig = (0, crypto_1.createHmac)('sha256', LICENSE_SECRET)
        .update(payload)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
    return `AZX-${slug.toUpperCase()}-${days}-${sig}`;
}
async function activateTenantLicenseKey(licenseKey) {
    const cleanKey = licenseKey.trim().toUpperCase();
    const parts = cleanKey.split('-');
    if (parts.length < 4 || parts[0] !== 'AZX') {
        throw new Error('Litsenziya kaliti formati yaroqsiz');
    }
    const slug = parts[1].toLowerCase();
    const days = parseInt(parts[2], 10);
    const signature = parts[3];
    const tenant = await db_1.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant)
        throw new Error('Kalitda ko‘rsatilgan restoran topilmadi');
    return extendTenantSubscription(tenant.id, days, 0, `Offline litsenziya kaliti orqali: ${cleanKey}`);
}
