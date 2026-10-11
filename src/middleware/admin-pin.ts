import { RequestHandler } from 'express';
import { prisma } from '../utils/db';
import { verifyPin } from '../utils/pin';
const attempts = new Map<string, { count: number; expires: number }>();
export const requireAdminPin: RequestHandler = async (req, res, next) => {
    try {
        const id = req.user!.id, now = Date.now();
        for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
        const current = attempts.get(id) || { count: 0, expires: now + 300000 };
        if (current.count >= 5) { res.status(429).json({ message: 'Urinishlar ko‘p. 5 daqiqadan keyin qayta urinib ko‘ring' }); return; }
        const pin = req.get('x-admin-pin'), user = await prisma.user.findUnique({ where: { id }, select: { pinCodeHash: true } });
        if (!pin || !/^\d{4}$/.test(pin) || !user?.pinCodeHash || !await verifyPin(pin, user.pinCodeHash)) {
            current.count++; attempts.set(id, current); res.status(403).json({ message: 'Admin PIN noto‘g‘ri yoki hali sozlanmagan' }); return;
        }
        attempts.delete(id); next();
    } catch { res.status(503).json({ message: 'PINni tekshirib bo‘lmadi' }); }
};
