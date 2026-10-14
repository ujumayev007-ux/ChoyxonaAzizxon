"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSuperOwnerToken = signSuperOwnerToken;
exports.verifySuperOwnerToken = verifySuperOwnerToken;
exports.loginSuperOwner = loginSuperOwner;
const db_1 = require("../utils/db");
const password_1 = require("../utils/password");
const crypto_1 = require("crypto");
const SUPER_OWNER_SECRET = process.env.SUPER_OWNER_JWT_SECRET || process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_super_owner_jwt_secret_2026';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
function signSuperOwnerToken(owner) {
    const payload = Buffer.from(JSON.stringify({
        id: owner.id,
        username: owner.username,
        fullName: owner.fullName,
        role: 'SUPER_OWNER',
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
        issuedAt: Date.now()
    })).toString('base64url');
    const signature = (0, crypto_1.createHmac)('sha256', SUPER_OWNER_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}
function verifySuperOwnerToken(token) {
    if (!token || typeof token !== 'string')
        return null;
    const [payload, signature, ...extra] = token.split('.');
    if (!payload || !signature || extra.length)
        return null;
    const expectedSig = (0, crypto_1.createHmac)('sha256', SUPER_OWNER_SECRET).update(payload).digest('base64url');
    if (signature !== expectedSig)
        return null;
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.role !== 'SUPER_OWNER' || decoded.exp < Date.now() / 1000) {
            return null;
        }
        return decoded;
    }
    catch {
        return null;
    }
}
async function loginSuperOwner(username, password) {
    const cleanUsername = username?.trim();
    if (!cleanUsername || !password) {
        return { success: false, message: 'Foydalanuvchi nomi va parol kiritilishi shart' };
    }
    // Check database
    let owner = await db_1.prisma.superOwner.findUnique({ where: { username: cleanUsername } });
    if (!owner) {
        // Fallback to initial credentials if DB is unseeded
        const envUser = process.env.SUPER_OWNER_USERNAME || 'superowner';
        const envPass = process.env.SUPER_OWNER_PASSWORD || 'SuperOwner2026!';
        if (cleanUsername === envUser && password === envPass) {
            const passHash = await (0, password_1.hashPassword)(envPass);
            owner = await db_1.prisma.superOwner.create({
                data: {
                    username: envUser,
                    passwordHash: passHash,
                    fullName: 'Super Administrator',
                    isActive: true
                }
            });
        }
        else {
            return { success: false, message: 'Foydalanuvchi nomi yoki parol noto‘g‘ri' };
        }
    }
    if (!owner.isActive) {
        return { success: false, message: 'Hisob faol emas. Ta’minotchi bilan bog‘laning.' };
    }
    const isValid = await (0, password_1.verifyPassword)(password, owner.passwordHash);
    if (!isValid) {
        return { success: false, message: 'Foydalanuvchi nomi yoki parol noto‘g‘ri' };
    }
    const token = signSuperOwnerToken({
        id: owner.id,
        username: owner.username,
        fullName: owner.fullName
    });
    return {
        success: true,
        token,
        user: {
            id: owner.id,
            username: owner.username,
            fullName: owner.fullName,
            role: 'SUPER_OWNER'
        }
    };
}
