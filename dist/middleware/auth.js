"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.authenticateToken = void 0;
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const db_1 = require("../utils/db");
const COOKIE_NAME = 'restaurant_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
let authSecret;
function getAuthSecret() {
    if (!authSecret) {
        authSecret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || (0, crypto_1.randomBytes)(32).toString('hex');
        if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET && !process.env.SESSION_SECRET) {
            console.warn('AUTH_SECRET is not configured; sessions will be invalidated when the server restarts.');
        }
    }
    return authSecret;
}
function sign(payload) {
    return (0, crypto_1.createHmac)('sha256', getAuthSecret()).update(payload).digest('base64url');
}
function setAuthCookie(res, user) {
    const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    })).toString('base64url');
    const value = `${payload}.${sign(payload)}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}
function clearAuthCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function readSession(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader)
        return null;
    const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
    if (!cookie)
        return null;
    const [payload, signature, ...extra] = cookie.slice(COOKIE_NAME.length + 1).split('.');
    if (!payload || !signature || extra.length)
        return null;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !(0, crypto_1.timingSafeEqual)(expected, received))
        return null;
    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof session.sub !== 'string' || typeof session.role !== 'string' ||
            !Object.values(client_1.RoleType).includes(session.role) ||
            typeof session.exp !== 'number' || session.exp <= Date.now() / 1000) {
            return null;
        }
        return { id: session.sub, role: session.role };
    }
    catch {
        return null;
    }
}
const authenticateToken = async (req, res, next) => {
    const session = readSession(req);
    if (!session) {
        res.status(401).json({ success: false, message: 'Tizimga qayta kiring' });
        return;
    }
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { id: session.id },
            select: { id: true, username: true, fullName: true, role: true, isActive: true }
        });
        if (!user || !user.isActive || user.role !== session.role) {
            res.status(401).json({ success: false, message: 'Foydalanuvchi sessiyasi faol emas' });
            return;
        }
        req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
        next();
    }
    catch (error) {
        console.error('Sessiyani tekshirishda xatolik:', error);
        res.status(503).json({ success: false, message: 'Autentifikatsiya xizmatida xatolik' });
    }
};
exports.authenticateToken = authenticateToken;
const requireRole = (roles) => {
    const allowedRoles = roles.map(role => role.toUpperCase());
    return (req, res, next) => {
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
exports.requireRole = requireRole;
