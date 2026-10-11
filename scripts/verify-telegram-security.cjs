const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecret, decryptSecret } = require('../dist/utils/secrets');
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
        const { sendToActiveSubscribers } = require('../dist/utils/telegram');
        assert.deepEqual(await sendToActiveSubscribers('Hisobot'), { success: 1, failed: 0 });
        assert.deepEqual(query.where, { isActive: true, verifiedAt: { not: null } });
        assert.equal(deliveries[0].status, 'YUBORILDI');
        assert(!JSON.stringify(deliveries).includes('test-only-token'));
    } finally { global.fetch = originalFetch; delete process.env.TELEGRAM_BOT_TOKEN; }
});
