"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const crypto_1 = require("crypto");
function hashPassword(password) {
    const salt = (0, crypto_1.randomBytes)(16).toString('hex');
    return new Promise((resolve, reject) => {
        (0, crypto_1.scrypt)(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`${salt}:${derivedKey.toString('hex')}`);
        });
    });
}
function verifyPassword(password, passwordHash) {
    const [salt, storedHash, ...extra] = passwordHash.split(':');
    if (!salt || !storedHash || extra.length || !/^[\da-f]+$/i.test(salt) || !/^[\da-f]{128}$/i.test(storedHash)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        (0, crypto_1.scrypt)(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            const expected = Buffer.from(storedHash, 'hex');
            resolve(expected.length === derivedKey.length && (0, crypto_1.timingSafeEqual)(expected, derivedKey));
        });
    });
}
