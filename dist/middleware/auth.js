"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireCashierAccess = exports.requireRole = exports.optionalAuthenticateToken = exports.authenticateToken = void 0;
exports.initializeAuthSecret = initializeAuthSecret;
exports.setAuthCookie = setAuthCookie;
exports.setTerminalAdminCookie = setTerminalAdminCookie;
exports.clearTerminalAdminCookie = clearTerminalAdminCookie;
exports.clearAuthCookie = clearAuthCookie;
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const db_1 = require("../utils/db");
const COOKIE_NAME = 'restaurant_session';
const TERMINAL_COOKIE_NAME = 'restaurant_admin_terminal';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
let authSecret;
function getAuthSecret() {
    if (!authSecret) {
        const configuredSecret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
        if (!configuredSecret && process.env.NODE_ENV === 'production') {
            throw new Error('Set a stable AUTH_SECRET or SESSION_SECRET in production to keep sessions valid.');
        }
        authSecret = configuredSecret || (0, crypto_1.randomBytes)(32).toString('hex');
    }
    return authSecret;
}
function initializeAuthSecret() {
    getAuthSecret();
}
function sign(payload) {
    return (0, crypto_1.createHmac)('sha256', getAuthSecret()).update(payload).digest('base64url');
}
function setAuthCookie(res, user) {
    clearTerminalAdminCookie(res);
    const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        issuedAt: Math.max(Date.now(), (user.updatedAt?.getTime() || 0) + 1)
    })).toString('base64url');
    const value = `${payload}.${sign(payload)}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const header = res.getHeader('Set-Cookie');
    const existing = Array.isArray(header) ? header : header ? [String(header)] : [];
    res.setHeader('Set-Cookie', [
        ...existing,
        `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
    ]);
}
function setTerminalAdminCookie(res, user, accessId) {
    const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        issuedAt: Math.max(Date.now(), (user.updatedAt?.getTime() || 0) + 1),
        terminalAccessId: accessId
    })).toString('base64url');
    const value = `${payload}.${sign(payload)}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const header = res.getHeader('Set-Cookie');
    const existing = Array.isArray(header) ? header : header ? [String(header)] : [];
    res.setHeader('Set-Cookie', [
        ...existing,
        `${TERMINAL_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
    ]);
}
function clearTerminalAdminCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const header = res.getHeader('Set-Cookie');
    const existing = Array.isArray(header) ? header : header ? [String(header)] : [];
    res.setHeader('Set-Cookie', [
        ...existing,
        `${TERMINAL_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
    ]);
}
function clearAuthCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const header = res.getHeader('Set-Cookie');
    const existing = Array.isArray(header) ? header : header ? [String(header)] : [];
    res.setHeader('Set-Cookie', [
        ...existing,
        `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
    ]);
}
function readSession(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader)
        return null;
    const cookies = cookieHeader.split(';').map(part => part.trim());
    // A cleared cookie (for example `restaurant_admin_terminal=`) may still be sent by the
    // browser alongside the active one. Only non-empty values count, otherwise the cleared
    // cookie would shadow the valid session and every request would fail authentication.
    const readCookie = (name) => {
        const prefix = `${name}=`;
        const match = cookies.find(part => part.startsWith(prefix) && part.length > prefix.length);
        return match?.slice(prefix.length);
    };
    const terminalValue = readCookie(TERMINAL_COOKIE_NAME);
    const standardValue = readCookie(COOKIE_NAME);
    const cookie = terminalValue ?? standardValue;
    if (!cookie)
        return null;
    const [payload, signature, ...extra] = cookie.split('.');
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
            typeof session.exp !== 'number' || session.exp <= Date.now() / 1000 ||
            typeof session.issuedAt !== 'number' || !Number.isSafeInteger(session.issuedAt)) {
            return null;
        }
        if (terminalValue && (session.role !== client_1.RoleType.ADMIN || typeof session.terminalAccessId !== 'string')) {
            return null;
        }
        return {
            id: session.sub,
            role: session.role,
            issuedAt: session.issuedAt,
            ...(typeof session.terminalAccessId === 'string' ? { terminalAccessId: session.terminalAccessId } : {})
        };
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
            select: { id: true, username: true, fullName: true, role: true, isActive: true, updatedAt: true }
        });
        if (!user || !user.isActive || user.role !== session.role || session.issuedAt <= user.updatedAt.getTime()) {
            res.status(401).json({ success: false, message: 'Foydalanuvchi sessiyasi faol emas' });
            return;
        }
        if (session.terminalAccessId) {
            const access = await db_1.prisma.adminTerminalAccess.findFirst({
                where: { id: session.terminalAccessId, adminId: user.id, endedAt: null },
                select: { id: true }
            });
            if (!access) {
                res.status(401).json({ success: false, message: 'Admin sessiyasi yakunlangan' });
                return;
            }
        }
        req.user = {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            sessionIssuedAt: session.issuedAt,
            ...(session.terminalAccessId ? { terminalAccessId: session.terminalAccessId } : {})
        };
        next();
    }
    catch (error) {
        console.error('Sessiyani tekshirishda xatolik:', error);
        res.status(503).json({ success: false, message: 'Autentifikatsiya xizmatida xatolik' });
    }
};
exports.authenticateToken = authenticateToken;
const optionalAuthenticateToken = async (req, res, next) => {
    const session = readSession(req);
    if (!session) {
        next();
        return;
    }
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { id: session.id },
            select: { id: true, username: true, fullName: true, role: true, isActive: true, updatedAt: true }
        });
        if (!user || !user.isActive || user.role !== session.role || session.issuedAt <= user.updatedAt.getTime()) {
            next();
            return;
        }
        if (session.terminalAccessId) {
            const access = await db_1.prisma.adminTerminalAccess.findFirst({
                where: { id: session.terminalAccessId, adminId: user.id, endedAt: null },
                select: { id: true }
            });
            if (!access) {
                next();
                return;
            }
        }
        req.user = {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            sessionIssuedAt: session.issuedAt,
            ...(session.terminalAccessId ? { terminalAccessId: session.terminalAccessId } : {})
        };
        next();
    }
    catch (error) {
        console.error('Ixtiyoriy sessiyani tekshirishda xatolik:', error);
        res.status(503).json({ success: false, message: 'Autentifikatsiya xizmatida xatolik' });
    }
};
exports.optionalAuthenticateToken = optionalAuthenticateToken;
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
const requireCashierAccess = (req, res, next) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: 'Tizimga qayta kiring' });
        return;
    }
    if (req.user.role !== client_1.RoleType.CASHIER &&
        !(req.user.role === client_1.RoleType.ADMIN && req.user.terminalAccessId)) {
        res.status(403).json({ success: false, message: 'Kassir hisobi yoki tasdiqlangan Admin terminali kerak' });
        return;
    }
    next();
};
exports.requireCashierAccess = requireCashierAccess;
