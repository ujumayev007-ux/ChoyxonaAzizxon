import { prisma } from '../utils/db';
import { verifyPassword, hashPassword } from '../utils/password';
import { createHmac, randomBytes } from 'crypto';

const SUPER_OWNER_SECRET = process.env.SUPER_OWNER_JWT_SECRET || process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_super_owner_jwt_secret_2026';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SuperOwnerSession {
    id: string;
    username: string;
    fullName: string;
    role: 'SUPER_OWNER';
    exp: number;
    issuedAt: number;
}

export function signSuperOwnerToken(owner: { id: string; username: string; fullName: string }): string {
    const payload = Buffer.from(JSON.stringify({
        id: owner.id,
        username: owner.username,
        fullName: owner.fullName,
        role: 'SUPER_OWNER',
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
        issuedAt: Date.now()
    })).toString('base64url');

    const signature = createHmac('sha256', SUPER_OWNER_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

export function verifySuperOwnerToken(token: string): SuperOwnerSession | null {
    if (!token || typeof token !== 'string') return null;
    const [payload, signature, ...extra] = token.split('.');
    if (!payload || !signature || extra.length) return null;

    const expectedSig = createHmac('sha256', SUPER_OWNER_SECRET).update(payload).digest('base64url');
    if (signature !== expectedSig) return null;

    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SuperOwnerSession;
        if (decoded.role !== 'SUPER_OWNER' || decoded.exp < Date.now() / 1000) {
            return null;
        }
        return decoded;
    } catch {
        return null;
    }
}

export async function loginSuperOwner(username: string, password: string):Promise<{ success: boolean; token?: string; user?: any; message?: string }> {
    const cleanUsername = username?.trim();
    if (!cleanUsername || !password) {
        return { success: false, message: 'Foydalanuvchi nomi va parol kiritilishi shart' };
    }

    // Check database
    let owner = await prisma.superOwner.findUnique({ where: { username: cleanUsername } });
    if (!owner) {
        // Fallback to initial credentials if DB is unseeded
        const envUser = process.env.SUPER_OWNER_USERNAME || 'superowner';
        const envPass = process.env.SUPER_OWNER_PASSWORD || 'SuperOwner2026!';
        if (cleanUsername === envUser && password === envPass) {
            const passHash = await hashPassword(envPass);
            owner = await prisma.superOwner.create({
                data: {
                    username: envUser,
                    passwordHash: passHash,
                    fullName: 'Super Administrator',
                    isActive: true
                }
            });
        } else {
            return { success: false, message: 'Foydalanuvchi nomi yoki parol noto‘g‘ri' };
        }
    }

    if (!owner.isActive) {
        return { success: false, message: 'Hisob faol emas. Ta’minotchi bilan bog‘laning.' };
    }

    const isValid = await verifyPassword(password, owner.passwordHash);
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

