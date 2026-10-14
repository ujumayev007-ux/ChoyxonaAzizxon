"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSubscription = void 0;
exports.getSubscription = getSubscription;
exports.setSubscription = setSubscription;
exports.getStatusSummary = getStatusSummary;
exports.extendSubscription = extendSubscription;
exports.toggleLock = toggleLock;
exports.generateLicenseKey = generateLicenseKey;
exports.activateLicenseKey = activateLicenseKey;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const socket_1 = require("../socket");
const DEFAULT_OWNER_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_master_secret_key_2026';
exports.defaultSubscription = {
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
async function getSubscription() {
    try {
        const row = await db_1.prisma.appSetting.findUnique({
            where: { key: 'subscription' }
        });
        if (!row || !row.value || typeof row.value !== 'object') {
            await setSubscription(exports.defaultSubscription);
            return exports.defaultSubscription;
        }
        return {
            ...exports.defaultSubscription,
            ...row.value,
            ownerContact: {
                ...exports.defaultSubscription.ownerContact,
                ...(row.value?.ownerContact || {})
            }
        };
    }
    catch (error) {
        console.error('Obuna ma’lumotlarini o‘qishda xatolik:', error);
        return exports.defaultSubscription;
    }
}
async function setSubscription(data) {
    const current = await getSubscription();
    const updated = {
        ...current,
        ...data,
        ownerContact: {
            ...current.ownerContact,
            ...(data.ownerContact || {})
        }
    };
    await db_1.prisma.appSetting.upsert({
        where: { key: 'subscription' },
        create: { key: 'subscription', value: updated },
        update: { value: updated }
    });
    // Notify all connected devices via Socket.io immediately
    (0, socket_1.emitSocketEvent)('subscription_status_changed', getStatusSummary(updated));
    return updated;
}
function getStatusSummary(sub) {
    const now = Date.now();
    const expiry = new Date(sub.expiresAt).getTime();
    const isExpired = expiry <= now;
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    let status = 'ACTIVE';
    if (sub.isLocked) {
        status = 'LOCKED';
    }
    else if (isExpired) {
        status = 'EXPIRED';
    }
    else if (daysLeft <= 3) {
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
async function extendSubscription(days, amount = 0, note = '') {
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
async function toggleLock(lock, reason) {
    return setSubscription({
        isLocked: lock,
        lockReason: lock ? (reason || 'Dastur ta’minotchi tomonidan qulflangan') : ''
    });
}
/**
 * Generates an offline cryptographically signed license activation key.
 * Format: DAYS-RANDOM-HASH (e.g. 30-AB12-F9D8)
 */
function generateLicenseKey(days) {
    const salt = (0, crypto_1.randomBytes)(2).toString('hex').toUpperCase();
    const payload = `${days}-${salt}`;
    const signature = (0, crypto_1.createHmac)('sha256', DEFAULT_OWNER_SECRET)
        .update(payload)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
    return `AZX-${days}-${salt}-${signature}`;
}
/**
 * Validates an offline license key and extends subscription.
 */
async function activateLicenseKey(keyStr) {
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
    const expectedSig = (0, crypto_1.createHmac)('sha256', DEFAULT_OWNER_SECRET)
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
