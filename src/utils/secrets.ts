import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
function key() {
    const value = process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.SESSION_SECRET;
    if (!value || value.length < 32) throw Error('ENCRYPTION_KEY_REQUIRED');
    return createHash('sha256').update(`restaurant-settings:${value}`).digest();
}
export function encryptSecret(value: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
}
export function decryptSecret(value: string): string {
    const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key(), iv); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
