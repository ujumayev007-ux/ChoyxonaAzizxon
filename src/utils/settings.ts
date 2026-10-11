import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
export const settingsVersion = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const defaults = {
    telegramReport: { enabled: false, revenue: true, cash: true, card: true, electronic: true, expenses: false, netProfit: false, debts: false, waiters: false, inventory: false, hourly: false, daily: true, times: '23:00', shiftOpen: false, shiftClose: true },
    payments: { cash: true, card: true, electronic: true, split: true, requireOpenShift: false, refunds: true, maxDiscountPercent: 10, debtLimit: 0, cashDifferenceLimit: 0 },
    orders: { autoApprove: true, cancellation: true, tableTransfer: true, waiterReassignment: true },
    waiterService: { scope: 'ALL', assign: true, deliver: true, requestReturn: true, requestCancel: true, transfer: false, reassign: false, takePayment: false, cashierReview: true, kitchenCancel: true, delayMinutes: 20 },
    kitchenTv: { showReady: true, soundEnabled: false, textScale: 100, refreshSeconds: 15, kitchenSection: '' },
    alerts: { lowStock: true, delayedOrderMinutes: 45, unclosedShiftHours: 16, printerFailures: true, backupFailures: true, failedPayments: true },
    restaurant: { restaurantName: 'ChoyxonaAzizxon', address: '', phone: '', timezone: 'Asia/Tashkent', logoUrl: '', workingHours: '09:00–23:00', serviceFeePercent: 0 }
};
export type SettingKey = keyof typeof defaults;
export function validateSettings(key: SettingKey, value: any) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(defaults[key], k))) throw Error('INVALID_SETTINGS');
    const result: any = { ...defaults[key], ...value };
    for (const [field, initial] of Object.entries(defaults[key])) {
        if (typeof result[field] !== typeof initial) throw Error('INVALID_SETTINGS');
        if (typeof initial === 'number' && (!Number.isFinite(result[field]) || result[field] < 0 || result[field] > (field.includes('Percent') ? 100 : 1000000000000))) throw Error('INVALID_SETTINGS');
        if (typeof initial === 'string' && result[field].length > 500) throw Error('INVALID_SETTINGS');
    }
    if (key === 'restaurant') {
        new Intl.DateTimeFormat('uz-UZ', { timeZone: result.timezone });
        if (!result.restaurantName.trim() || (result.logoUrl && !/^https:\/\//.test(result.logoUrl))) throw Error('INVALID_SETTINGS');
    }
    if (key === 'waiterService' && (!['ALL', 'OWN'].includes(result.scope) || result.delayMinutes < 1 || result.delayMinutes > 240)) throw Error('INVALID_SETTINGS');
    if (key === 'kitchenTv' && (result.textScale < 70 || result.textScale > 150 || !Number.isInteger(result.refreshSeconds) || result.refreshSeconds < 5 || result.refreshSeconds > 120 || result.kitchenSection.length > 100)) throw Error('INVALID_SETTINGS');
    if (key === 'telegramReport' && (!/^(?:[01]\d|2[0-3]):[0-5]\d(?:,(?:[01]\d|2[0-3]):[0-5]\d){0,23}$/.test(result.times))) throw Error('INVALID_SETTINGS');
    return result;
}
export async function getSettings<K extends SettingKey>(db: Prisma.TransactionClient, key: K): Promise<typeof defaults[K]> {
    if (key === 'restaurant') {
        const row = await db.restaurantSetting.findFirst();
        return (row ? { restaurantName: row.restaurantName, address: row.address, phone: row.phone, timezone: row.timezone,
            logoUrl: row.logoUrl || '', workingHours: row.workingHours, serviceFeePercent: Number(row.serviceFeePercent) } : defaults.restaurant) as typeof defaults[K];
    }
    const row = await db.appSetting.findUnique({ where: { key } });
    return { ...defaults[key], ...(row?.value as object || {}) };
}
export async function saveSettings(db: Prisma.TransactionClient, key: SettingKey, value: unknown, actorId: string) {
    const data = validateSettings(key, value), previous = await getSettings(db, key);
    if (key === 'restaurant') {
        const row = await db.restaurantSetting.findFirst();
        if (row) await db.restaurantSetting.update({ where: { id: row.id }, data });
        else await db.restaurantSetting.create({ data });
        await db.printConfig.upsert({ where: { id: 'default' }, create: { id: 'default', header: data.restaurantName }, update: { header: data.restaurantName } });
    } else await db.appSetting.upsert({ where: { key }, create: { key, value: data }, update: { value: data } });
    const revision = await db.settingRevision.create({ data: { key, actorId, previous, value: data } });
    await db.auditLog.create({ data: { userId: actorId, action: 'SETTINGS_UPDATED', entity: 'AppSetting', entityId: key, oldValue: JSON.stringify(previous), newValue: JSON.stringify(data) } });
    return revision;
}
