"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const license_1 = require("../utils/license");
const db_1 = require("../utils/db");
const crypto_1 = require("crypto");
const router = (0, express_1.Router)();
const OWNER_SECRET = process.env.OWNER_SECRET_KEY || 'choyxona_azizxon_master_secret_key_2026';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'azizxon2026owner';
// Helper to sign and verify owner sessions
function signToken(payload) {
    return (0, crypto_1.createHmac)('sha256', OWNER_SECRET).update(payload).digest('base64url');
}
function verifyOwnerAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const cookieToken = req.headers.cookie?.split(';').find(c => c.trim().startsWith('owner_session='))?.split('=')[1];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Owner autentifikatsiyasi talab qilinadi' });
    }
    const [payload, signature] = token.split('.');
    if (!payload || !signature) {
        return res.status(401).json({ success: false, message: 'Token yaroqsiz' });
    }
    const expectedSig = signToken(payload);
    if (signature !== expectedSig) {
        return res.status(401).json({ success: false, message: 'Noto‘g‘ri imzo' });
    }
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.role !== 'OWNER' || decoded.exp < Date.now() / 1000) {
            return res.status(401).json({ success: false, message: 'Sessiya muddati tugagan' });
        }
        req.owner = decoded;
        next();
    }
    catch {
        return res.status(401).json({ success: false, message: 'Tokenni o‘qib bo‘lmadi' });
    }
}
// -------------------------------------------------------------
// 1. PUBLIC SUBSCRIPTION ENDPOINTS (FOR CLIENT PANELS)
// -------------------------------------------------------------
router.get('/subscription/status', async (_req, res) => {
    try {
        const sub = await (0, license_1.getSubscription)();
        res.json({ success: true, data: (0, license_1.getStatusSummary)(sub) });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Obuna holatini olib bo‘lmadi' });
    }
});
router.post('/subscription/activate', async (req, res) => {
    try {
        const { key } = req.body;
        if (!key || typeof key !== 'string') {
            return res.status(400).json({ success: false, message: 'Litsenziya kaliti kiritilmagan' });
        }
        const result = await (0, license_1.activateLicenseKey)(key);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error?.message || 'Faollashtirishda xatolik yuz berdi' });
    }
});
// -------------------------------------------------------------
// 2. OWNER AUTHENTICATION
// -------------------------------------------------------------
router.post('/owner/login', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password !== OWNER_PASSWORD) {
            return res.status(401).json({ success: false, message: 'Owner paroli noto‘g‘ri' });
        }
        const payload = Buffer.from(JSON.stringify({
            role: 'OWNER',
            issuedAt: Date.now(),
            exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
        })).toString('base64url');
        const token = `${payload}.${signToken(payload)}`;
        res.setHeader('Set-Cookie', [
            `owner_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`
        ]);
        res.json({ success: true, token, message: 'Muvaffaqiyatli kirdingiz' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Tizimga kirishda xatolik yuz berdi' });
    }
});
router.post('/owner/logout', (_req, res) => {
    res.setHeader('Set-Cookie', [
        `owner_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    ]);
    res.json({ success: true, message: 'Chiqildi' });
});
// -------------------------------------------------------------
// 3. OWNER MANAGEMENT ENDPOINTS (PROTECTED)
// -------------------------------------------------------------
router.get('/owner/status', verifyOwnerAuth, async (_req, res) => {
    try {
        const [sub, orderCount, userCount, activeRooms] = await Promise.all([
            (0, license_1.getSubscription)(),
            db_1.prisma.order.count(),
            db_1.prisma.user.count(),
            db_1.prisma.room.count({ where: { isActive: true } })
        ]);
        const summary = (0, license_1.getStatusSummary)(sub);
        res.json({
            success: true,
            subscription: sub,
            summary,
            metrics: {
                totalOrders: orderCount,
                totalUsers: userCount,
                activeRooms,
                serverTime: new Date().toISOString()
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Ma’lumotlarni yuklab bo‘lmadi' });
    }
});
router.post('/owner/lock', verifyOwnerAuth, async (req, res) => {
    try {
        const { lock, reason } = req.body;
        const updated = await (0, license_1.toggleLock)(Boolean(lock), reason);
        res.json({
            success: true,
            message: lock ? 'Dastur masofadan qulflandi' : 'Dastur qulfdan chiqarildi',
            summary: (0, license_1.getStatusSummary)(updated)
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Qulflash holatini o‘zgartirib bo‘lmadi' });
    }
});
router.post('/owner/extend', verifyOwnerAuth, async (req, res) => {
    try {
        const days = parseInt(req.body.days, 10);
        const amount = Number(req.body.amount || 0);
        const note = req.body.note || '';
        if (isNaN(days) || days <= 0) {
            return res.status(400).json({ success: false, message: 'Kunlar soni noto‘g‘ri' });
        }
        const updated = await (0, license_1.extendSubscription)(days, amount, note);
        res.json({
            success: true,
            message: `Obuna +${days} kunga muvaffaqiyatli uzaytirildi!`,
            summary: (0, license_1.getStatusSummary)(updated)
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Obunani uzaytirishda xatolik yuz berdi' });
    }
});
router.post('/owner/generate-key', verifyOwnerAuth, async (req, res) => {
    try {
        const days = parseInt(req.body.days || 30, 10);
        if (isNaN(days) || days <= 0 || days > 3650) {
            return res.status(400).json({ success: false, message: 'Kunlar soni 1 va 3650 oralig‘ida bo‘lishi kerak' });
        }
        const licenseKey = (0, license_1.generateLicenseKey)(days);
        res.json({
            success: true,
            days,
            licenseKey,
            instructions: `Ushbu kalitni mijozga yuboring. Ular qulflangan ekranda yoki sozlamalarda kalitni kiritib, tizimni ${days} kunga faollashtira oladilar.`
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Kalit yaratishda xatolik' });
    }
});
router.put('/owner/settings', verifyOwnerAuth, async (req, res) => {
    try {
        const { monthlyFee, clientName, clientPhone, restaurantName, ownerContact } = req.body;
        const current = await (0, license_1.getSubscription)();
        const updated = await (0, license_1.setSubscription)({
            monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : current.monthlyFee,
            clientName: clientName !== undefined ? String(clientName) : current.clientName,
            clientPhone: clientPhone !== undefined ? String(clientPhone) : current.clientPhone,
            restaurantName: restaurantName !== undefined ? String(restaurantName) : current.restaurantName,
            ownerContact: {
                ...current.ownerContact,
                ...(ownerContact || {})
            }
        });
        res.json({
            success: true,
            message: 'Sozlamalar yangilandi',
            summary: (0, license_1.getStatusSummary)(updated)
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Sozlamalarni saqlashda xatolik' });
    }
});
exports.default = router;
