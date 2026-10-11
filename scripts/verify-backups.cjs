const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backupModels, backupSelect, businessSnapshot } = require('../dist/utils/backups');
test('Biznes nusxasi parol, PIN, token va sessiyalarni eksport qilmaydi', () => {
    const user = backupSelect('User');
    assert.equal(user.fullName, true);
    assert(!Object.keys(user).some(k => /password|pin|token|secret/i.test(k)));
    assert(!backupModels.includes('AuthSession'));
    assert.throws(() => backupSelect('AppSetting'));
    assert.throws(() => backupSelect('DataBackup'));
});
test('Nusxada jadvallar sanaladi va chegaradan katta nusxa qisman saqlanmaydi', async () => {
    let queried = 0;
    const tx = { restaurantSetting: { findFirst: async () => null }, appSetting: { findUnique: async () => null } };
    for (const name of backupModels) {
        const key = name[0].toLowerCase() + name.slice(1);
        tx[key] = { ...tx[key], count: async () => 1, findMany: async ({select}) => { queried++; assert(!Object.keys(select).some(k => /password|pin|token|secret/i.test(k))); return [{id:'example'}]; } };
    }
    const snapshot = await businessSnapshot(tx);
    assert.equal(snapshot.format, 'choyxona-business-v1'); assert.equal(queried, backupModels.length);
    tx.user.count = async () => 200001;
    await assert.rejects(businessSnapshot(tx), /BACKUP_TOO_LARGE/);
});
