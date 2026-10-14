import { prisma } from '../utils/db';
import { emitSocketEvent } from '../socket';
import { createHmac, randomBytes } from 'crypto';

const LICENSE_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_license_secret_2026';

export interface CreateTenantInput {
    slug: string;
    name: string;
    ownerName: string;
    ownerPhone: string;
    address?: string;
    monthlyFee?: number;
    subscriptionPlan?: string;
}

export async function getAllTenants() {
    return prisma.tenant.findMany({
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

export async function getTenantById(id: string) {
    return prisma.tenant.findUnique({
        where: { id },
        include: {
            devices: { orderBy: { requestedAt: 'desc' } },
            payments: { orderBy: { createdAt: 'desc' }, take: 50 },
            auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 }
        }
    });
}

export async function getTenantBySlug(slug: string) {
    return prisma.tenant.findUnique({
        where: { slug }
    });
}

export async function registerNewTenant(input: CreateTenantInput) {
    const slug = input.slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
        throw new Error(`Ushbu identifikator (${slug}) bilan restoran allaqachon mavjud`);
    }

    const tenant = await prisma.tenant.create({
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

    emitSocketEvent('owner_new_registration', {
        tenantId: tenant.id,
        name: tenant.name,
        ownerPhone: tenant.ownerPhone,
        requestedAt: tenant.createdAt
    });

    return tenant;
}

export async function approveTenant(tenantId: string, superOwnerId?: string, initialDays = 30) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Restoran topilmadi');

    const periodEnd = new Date(Date.now() + initialDays * 24 * 60 * 60 * 1000);
    const updated = await prisma.tenant.update({
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

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'RESTAURANT_APPROVED',
            entity: 'Tenant',
            entityId: tenantId,
            details: { name: tenant.name, initialDays, periodEnd }
        }
    });

    emitSocketEvent('tenant_status_updated', {
        tenantId: updated.id,
        status: updated.status,
        currentPeriodEnd: updated.currentPeriodEnd
    });

    return updated;
}

export async function rejectTenant(tenantId: string, reason: string, superOwnerId?: string) {
    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            status: 'REJECTED',
            statusReason: reason || 'Super Owner tomonidan rad etildi',
            isLocked: true,
            lockReason: reason || 'Ro‘yxatdan o‘tish arizasi rad etilgan.'
        }
    });

    await prisma.ownerAuditLog.create({
        data: {
            superOwnerId,
            tenantId,
            action: 'RESTAURANT_REJECTED',
            entity: 'Tenant',
            entityId: tenantId,
            details: { reason }
        }
    });

    emitSocketEvent('tenant_status_updated', {
        tenantId: updated.id,
        status: updated.status,
        lockReason: updated.lockReason
    });

    return updated;
}

export async function setTenantLock(tenantId: string, lock: boolean, reason?: string, superOwnerId?: string) {
    const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            isLocked: lock,
            lockReason: lock ? (reason || 'Dastur Super Owner tomonidan masofadan qulflangan.') : null,
            status: lock ? 'LOCKED' : 'ACTIVE'
        }
    });

    await prisma.ownerAuditLog.create({
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
    emitSocketEvent('tenant_lock_changed', {
        tenantId: updated.id,
        isLocked: updated.isLocked,
        lockReason: updated.lockReason,
        status: updated.status
    });

    return updated;
}

export async function extendTenantSubscription(tenantId: string, days: number, amount = 0, notes = '', superOwnerId?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Restoran topilmadi');

    const currentEnd = new Date(tenant.currentPeriodEnd).getTime();
    const baseTime = currentEnd > Date.now() ? currentEnd : Date.now();
    const newEnd = new Date(baseTime + days * 24 * 60 * 60 * 1000);

    const paymentAmount = amount || (Number(tenant.monthlyFee) / 30) * days;

    const [updatedTenant] = await prisma.$transaction([
        prisma.tenant.update({
            where: { id: tenantId },
            data: {
                currentPeriodEnd: newEnd,
                status: 'ACTIVE',
                isLocked: false,
                lockReason: null
            }
        }),
        prisma.tenantPayment.create({
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
        prisma.ownerAuditLog.create({
            data: {
                superOwnerId,
                tenantId,
                action: 'SUBSCRIPTION_EXTENDED',
                entity: 'TenantPayment',
                details: { days, paymentAmount, newEnd }
            }
        })
    ]);

    emitSocketEvent('tenant_status_updated', {
        tenantId: updatedTenant.id,
        status: updatedTenant.status,
        currentPeriodEnd: updatedTenant.currentPeriodEnd
    });

    return updatedTenant;
}

export function generateTenantLicenseKey(slug: string, days: number): string {
    const salt = randomBytes(2).toString('hex').toUpperCase();
    const payload = `${slug.toUpperCase()}-${days}-${salt}`;
    const sig = createHmac('sha256', LICENSE_SECRET)
        .update(payload)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
    return `AZX-${slug.toUpperCase()}-${days}-${sig}`;
}

export async function activateTenantLicenseKey(licenseKey: string) {
    const cleanKey = licenseKey.trim().toUpperCase();
    const parts = cleanKey.split('-');
    if (parts.length < 4 || parts[0] !== 'AZX') {
        throw new Error('Litsenziya kaliti formati yaroqsiz');
    }

    const slug = parts[1].toLowerCase();
    const days = parseInt(parts[2], 10);
    const signature = parts[3];

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error('Kalitda ko‘rsatilgan restoran topilmadi');

    return extendTenantSubscription(tenant.id, days, 0, `Offline litsenziya kaliti orqali: ${cleanKey}`);
}

