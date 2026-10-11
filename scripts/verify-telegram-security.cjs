const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecret, decryptSecret } = require('../dist/utils/secrets');
const dbPath = require.resolve('../dist/utils/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: new Proxy({}, { get() { throw Error('Test database stub required'); } }) } };
test('Telegram jadvali Toshkent vaqtida kun va soat chegaralarini ajratadi', () => {
    const { reportSlot } = require('../dist/utils/telegram-reports');
    assert.equal(reportSlot(new Date('2026-10-11T18:00:00Z'), 'Asia/Tashkent', false, true, '12:00,23:00'), '2026-10-11:23:00');
    assert.equal(reportSlot(new Date('2026-10-11T18:01:00Z'), 'Asia/Tashkent', true, true, '23:00'), null);
    assert.equal(reportSlot(new Date('2026-10-11T19:00:00Z'), 'Asia/Tashkent', true, false, '23:00'), '2026-10-12:00:00');
});
test('Bot tokeni tasodifiy shifrlanadi va buzilgan qiymat ochilmaydi', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key-12345678901234567890';
    const value = 'test-only-token';
    const first = encryptSecret(value), second = encryptSecret(value);
    assert.notEqual(first, second); assert(!first.includes(value));
    assert.equal(decryptSecret(first), value);
    const parts = first.split('.'); const bytes = Buffer.from(parts[2], 'base64'); bytes[0] ^= 1; parts[2] = bytes.toString('base64');
    assert.throws(() => decryptSecret(parts.join('.')));
    delete process.env.SETTINGS_ENCRYPTION_KEY;
});
test('Tasdiqlanmagan Telegram hisobiga moliyaviy xabar yuborilmaydi', async () => {
    const path = require.resolve('../dist/utils/db'); let query, deliveries = [];
    require.cache[path] = { id: path, filename: path, loaded: true, exports: { prisma: {
        telegramSubscriber: { findMany: async args => { query = args; return [{ chatId: '123' }]; } },
        appSetting: { findUnique: async () => null },
        telegramDelivery: { create: async ({data}) => { deliveries.push(data); } }
    } } };
    process.env.TELEGRAM_BOT_TOKEN = 'test-only-token';
    const originalFetch = global.fetch; global.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    try {
        delete require.cache[require.resolve('../dist/utils/telegram')];
        const { sendToActiveSubscribers } = require('../dist/utils/telegram');
        assert.deepEqual(await sendToActiveSubscribers('Hisobot'), { success: 1, failed: 0 });
        assert.deepEqual(query.where, { isActive: true, verifiedAt: { not: null } });
        assert.equal(deliveries[0].status, 'YUBORILDI');
        assert(!JSON.stringify(deliveries).includes('test-only-token'));
    } finally { global.fetch = originalFetch; delete process.env.TELEGRAM_BOT_TOKEN; }
});
