import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';

export function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`${salt}:${derivedKey.toString('hex')}`);
        });
    });
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [salt, storedHash, ...extra] = passwordHash.split(':');
    if (!salt || !storedHash || extra.length || !/^[\da-f]+$/i.test(salt) || !/^[\da-f]{128}$/i.test(storedHash)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            const expected = Buffer.from(storedHash, 'hex');
            resolve(expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey));
        });
    });
}
