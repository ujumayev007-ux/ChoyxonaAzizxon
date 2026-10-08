/* Read-only admin authentication diagnostic.
 * Verifies: ADMIN accounts exist, password hashes are valid scrypt, and a
 * candidate username/password (from env) actually verifies against the hash.
 * Never prints or stores plain-text passwords and never mutates data.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('crypto');

const prisma = new PrismaClient();

function verifyPassword(password, passwordHash) {
    const [salt, storedHash, ...extra] = String(passwordHash).split(':');
    if (!salt || !storedHash || extra.length || !/^[\da-f]+$/i.test(salt) || !/^[\da-f]{128}$/i.test(storedHash)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, 64, (error, derivedKey) => {
            if (error) return reject(error);
            const expected = Buffer.from(storedHash, 'hex');
            resolve(expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey));
        });
    });
}

(async () => {
    try {
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN' },
            select: { id: true, username: true, fullName: true, isActive: true, passwordHash: true }
        });

        console.log(`ADMIN accounts found: ${admins.length}`);
        for (const admin of admins) {
            const hashShape = /^[\da-f]{32}:[\da-f]{128}$/i.test(admin.passwordHash);
            console.log(` - username=${admin.username} active=${admin.isActive} hashAlgorithm=scrypt hashValidShape=${hashShape}`);
        }

        const checkUser = process.env.VERIFY_ADMIN_USERNAME;
        const checkPass = process.env.VERIFY_ADMIN_PASSWORD;
        if (checkUser && checkPass) {
            const target = admins.find(admin => admin.username === checkUser);
            if (!target) {
                console.log(`Candidate username '${checkUser}' is not an ADMIN account.`);
            } else {
                const ok = await verifyPassword(checkPass, target.passwordHash);
                console.log(`Password verification for '${checkUser}': ${ok ? 'SUCCESS' : 'FAILED'}`);
            }
        } else {
            console.log('Set VERIFY_ADMIN_USERNAME/VERIFY_ADMIN_PASSWORD to test a specific credential at runtime.');
        }
    } catch (error) {
        console.error('Diagnostic failed:', error.message);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
})();
