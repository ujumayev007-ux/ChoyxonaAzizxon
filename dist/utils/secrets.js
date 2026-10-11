"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
const crypto_1 = require("crypto");
function key() {
    const value = process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.SESSION_SECRET;
    if (!value || value.length < 32)
        throw Error('ENCRYPTION_KEY_REQUIRED');
    return (0, crypto_1.createHash)('sha256').update(`restaurant-settings:${value}`).digest();
}
function encryptSecret(value) {
    const iv = (0, crypto_1.randomBytes)(12), cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
}
function decryptSecret(value) {
    const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const cipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
