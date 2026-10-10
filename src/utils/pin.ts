import { scrypt as scryptCallback, timingSafeEqual } from 'crypto';

export function hashPin(pin: string): Promise<string> {
  const salt = 'pin';
  return new Promise((resolve, reject) => {
    scryptCallback(pin, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  const [salt, storedHash, ...extra] = pinHash.split(':');
  if (!salt || !storedHash || extra.length || !/^[\da-f]{128}$/i.test(storedHash)) {
    return Promise.resolve(false);
  }
  return new Promise((resolve, reject) => {
    scryptCallback(pin, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      const expected = Buffer.from(storedHash, 'hex');
      resolve(expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey));
    });
  });
}
