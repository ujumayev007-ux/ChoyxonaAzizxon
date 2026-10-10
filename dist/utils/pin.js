"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPin = hashPin;
exports.verifyPin = verifyPin;
const crypto_1 = require("crypto");
function hashPin(pin) {
    const salt = 'pin';
    return new Promise((resolve, reject) => {
        (0, crypto_1.scrypt)(pin, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`${salt}:${derivedKey.toString("hex")}`);
        });
    });
}
function verifyPin(pin, pinHash) {
    const [salt, storedHash, ...extra] = pinHash.split(':');
    if (!salt || !storedHash || extra.length || !/^[\da-f]{128}$/i.test(storedHash)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        (0, crypto_1.scrypt)(pin, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            const expected = Buffer.from(storedHash, 'hex');
            resolve(expected.length === derivedKey.length && (0, crypto_1.timingSafeEqual)(expected, derivedKey));
        });
    });
}
