import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { RoleType } from '@prisma/client';
import { prisma } from '../utils/db';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                username: string;
                fullName: string;
                role: RoleType;
            };
        }
    }
}

const COOKIE_NAME = 'restaurant_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
let authSecret: string | undefined;

function getAuthSecret(): string {
    if (!authSecret) {
        const configuredSecret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
        if (!configuredSecret && process.env.NODE_ENV === 'production') {
            throw new Error('Set a stable AUTH_SECRET or SESSION_SECRET in production to keep sessions valid.');
        }
        authSecret = configuredSecret || randomBytes(32).toString('hex');
    }
    return authSecret;
}

export function initializeAuthSecret(): void {
    getAuthSecret();
}

function sign(payload: string): string {
    return createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
}

export function setAuthCookie(res: Response, user: { id: string; role: RoleType }): void {
    const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    })).toString('base64url');
    const value = `${payload}.${sign(payload)}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearAuthCookie(res: Response): void {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function readSession(req: Request): { id: string; role: RoleType } | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
    if (!cookie) return null;

    const [payload, signature, ...extra] = cookie.slice(COOKIE_NAME.length + 1).split('.');
    if (!payload || !signature || extra.length) return null;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
            sub?: unknown;
            role?: unknown;
            exp?: unknown;
        };
        if (typeof session.sub !== 'string' || typeof session.role !== 'string' ||
            !Object.values(RoleType).includes(session.role as RoleType) ||
            typeof session.exp !== 'number' || session.exp <= Date.now() / 1000) {
            return null;
        }
        return { id: session.sub, role: session.role as RoleType };
    } catch {
        return null;
    }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const session = readSession(req);
    if (!session) {
        res.status(401).json({ success: false, message: 'Tizimga qayta kiring' });
        return;
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: session.id },
            select: { id: true, username: true, fullName: true, role: true, isActive: true }
        });
        if (!user || !user.isActive || user.role !== session.role) {
            res.status(401).json({ success: false, message: 'Foydalanuvchi sessiyasi faol emas' });
            return;
        }
        req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
        next();
    } catch (error) {
        console.error('Sessiyani tekshirishda xatolik:', error);
        res.status(503).json({ success: false, message: 'Autentifikatsiya xizmatida xatolik' });
    }
};

export const requireRole = (roles: string[]) => {
    const allowedRoles = roles.map(role => role.toUpperCase());
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Tizimga qayta kiring' });
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({ success: false, message: 'Bu amal uchun ruxsat yo‘q' });
            return;
        }
        next();
    };
};
