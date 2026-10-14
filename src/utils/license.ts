import { createHmac, randomBytes } from 'crypto';
import { prisma } from './db';
import { emitSocketEvent } from '../socket';

export interface SubscriptionData {
    isLocked: boolean;
    lockReason?: string;
    expiresAt: string; // ISO string
    monthlyFee: number; // e.g. 500000 UZS
    currency: string;
    clientName: string;
    clientPhone: string;
    restaurantName: string;
    ownerContact: {
        phone: string;
        telegram: string;
        cardInfo: string;
        note: string;
    };
    lastPaymentDate?: string;
    history: Array<{
        date: string;
        amount: number;
        extendedDays: number;
        note?: string;
    }>;
}

const DEFAULT_OWNER_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_master_secret_key_2026';

export const defaultSubscription: SubscriptionData = {
    isLocked: false,
    lockReason: '',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days initial
    monthlyFee: 500000,
    currency: 'UZS',
    clientName: 'Restoran Rahbari',
    clientPhone: '+998 90 000-00-00',
    restaurantName: 'ChoyxonaAzizxon',
    ownerContact: {
        phone: '+998 99 999-99-99',
        telegram: '@dastur_ta’minotchisi',
        cardInfo: '8600 **** **** 1234',
        note: 'To‘lov chekini telegram orqali yuboring'
    },
    lastPaymentDate: new Date().toISOString(),
    history: [
        {
            date: new Date().toISOString(),
            amount: 500000,
            extendedDays: 30,
            note: 'Dastlabki 1 oylik litsenziya'
        }
    ]
};

export async function getSubscription(): Promise<SubscriptionData> {
    try {
        const row = await prisma.appSetting.findUnique({
            where: { key: 'subscription' }
        });
        if (!row || !row.value || typeof row.value !== 'object') {
            await setSubscription(defaultSubscription);
            return defaultSubscription;
        }
        return {
            ...defaultSubscription,
            ...(row.value as Record<string, any>),
            ownerContact: {
                ...defaultSubscription.ownerContact,
                ...((row.value as any)?.ownerContact || {})
            }
        };
    } catch (error) {
        console.error('Obuna ma’lumotlarini o‘qishda xatolik:', error);
        return defaultSubscription;
    }
}

export async function setSubscription(data: Partial<SubscriptionData>): Promise<SubscriptionData> {
    const current = await getSubscription();
    const updated: SubscriptionData = {
        ...current,
        ...data,
        ownerContact: {
            ...current.ownerContact,
            ...(data.ownerContact || {})
        }
    };
    await prisma.appSetting.upsert({
        where: { key: 'subscription' },
        create: { key: 'subscription', value: updated as any },
        update: { value: updated as any }
    });

    // Notify all connected devices via Socket.io immediately
    emitSocketEvent('subscription_status_changed', getStatusSummary(updated));
    return updated;
}

export function getStatusSummary(sub: SubscriptionData) {
    const now = Date.now();
    const expiry = new Date(sub.expiresAt).getTime();
    const isExpired = expiry <= now;
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    let status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'LOCKED' = 'ACTIVE';
    if (sub.isLocked) {
        status = 'LOCKED';
    } else if (isExpired) {
        status = 'EXPIRED';
    } else if (daysLeft <= 3) {
        status = 'EXPIRING_SOON';
    }

    return {
        status,
        isLocked: sub.isLocked,
        isExpired,
        daysLeft: Math.max(0, daysLeft),
        expiresAt: sub.expiresAt,
        lockReason: sub.lockReason || (isExpired ? 'Oylik to‘lov muddati tugagan' : ''),
        restaurantName: sub.restaurantName,
        clientName: sub.clientName,
        clientPhone: sub.clientPhone,
        monthlyFee: sub.monthlyFee,
        currency: sub.currency,
        ownerContact: sub.ownerContact
    };
}

export async function extendSubscription(days: number, amount = 0, note = ''): Promise<SubscriptionData> {
    const current = await getSubscription();
    const currentExpiry = new Date(current.expiresAt).getTime();
    const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
    const newExpiry = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();

    const history = [
        ...(current.history || []),
        {
            date: new Date().toISOString(),
            amount: amount || (current.monthlyFee / 30) * days,
            extendedDays: days,
            note: note || `+${days} kun obuna uzaytirildi`
        }
    ];

    return setSubscription({
        expiresAt: newExpiry,
        isLocked: false,
        lockReason: '',
        lastPaymentDate: new Date().toISOString(),
        history
    });
}

export async function toggleLock(lock: boolean, reason?: string): Promise<SubscriptionData> {
    return setSubscription({
        isLocked: lock,
        lockReason: lock ? (reason || 'Dastur ta’minotchi tomonidan qulflangan') : ''
    });
}

/**
 * Generates an offline cryptographically signed license activation key.
 * Format: DAYS-RANDOM-HASH (e.g. 30-AB12-F9D8)
 */
export function generateLicenseKey(days: number): string {
    const salt = randomBytes(2).toString('hex').toUpperCase();
    const payload = `${days}-${salt}`;
    const signature = createHmac('sha256', DEFAULT_OWNER_SECRET)
        .update(payload)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
    return `AZX-${days}-${salt}-${signature}`;
}

/**
 * Validates an offline license key and extends subscription.
 */
export async function activateLicenseKey(keyStr: string): Promise<{ success: boolean; message: string; days?: number }> {
    const cleanKey = keyStr.trim().toUpperCase();
    const parts = cleanKey.split('-');
    if (parts.length !== 4 || parts[0] !== 'AZX') {
        return { success: false, message: 'Litsenziya kaliti formati noto‘g‘ri' };
    }

    const days = parseInt(parts[1], 10);
    const salt = parts[2];
    const signature = parts[3];

    if (isNaN(days) || days <= 0 || days > 3650) {
        return { success: false, message: 'Litsenziya kunlar soni noto‘g‘ri' };
    }

    const payload = `${days}-${salt}`;
    const expectedSig = createHmac('sha256', DEFAULT_OWNER_SECRET)
        .update(payload)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();

    if (signature !== expectedSig) {
        return { success: false, message: 'Litsenziya kaliti haqiqiy emas yoki muddati o‘tgan' };
    }

    // Check if this key was already used in history
    const current = await getSubscription();
    const alreadyUsed = current.history.some(h => h.note?.includes(cleanKey));
    if (alreadyUsed) {
        return { success: false, message: 'Ushbu litsenziya kaliti allaqachon faollashtirilgan' };
    }

    await extendSubscription(days, 0, `Litsenziya kaliti orqali faollashtirildi: ${cleanKey}`);
    return { success: true, message: `Dastur muvaffaqiyatli ${days} kunga faollashtirildi!`, days };
}

