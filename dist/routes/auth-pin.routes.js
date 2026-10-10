"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const db_1 = require("../utils/db");
const pin_1 = require("../utils/pin");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const rateLimitMap = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
        return false;
    }
    if (entry.count >= 5) {
        return true;
    }
    entry.count++;
    return false;
}
router.post('/pin-login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
        res.status(429).json({ success: false, message: 'Juda ko\'p urinishlar. Keyinroq qayta urinib ko\'ring.' });
        return;
    }
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!/^\d{4}$/.test(pin)) {
        res.status(400).json({ success: false, message: 'PIN-kod 4 raqamdan iborat bo\'lishi kerak' });
        return;
    }
    try {
        const users = await db_1.prisma.user.findMany({
            where: {
                pinCodeHash: { not: null },
                role: { in: [client_1.RoleType.WAITER, client_1.RoleType.CASHIER] },
                isActive: true
            },
            select: { id: true, username: true, fullName: true, role: true, pinCodeHash: true, updatedAt: true }
        });
        for (const user of users) {
            if (user.pinCodeHash && (await (0, pin_1.verifyPin)(pin, user.pinCodeHash))) {
                (0, auth_1.setAuthCookie)(res, { id: user.id, role: user.role, updatedAt: user.updatedAt });
                res.json({
                    success: true,
                    user: {
                        id: user.id,
                        fullName: user.fullName,
                        role: user.role,
                        username: user.username
                    }
                });
                return;
            }
        }
        res.status(401).json({ success: false, message: 'PIN-kod noto\'g\'ri' });
    }
    catch (error) {
        console.error('PIN login error:', error);
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
exports.default = router;
