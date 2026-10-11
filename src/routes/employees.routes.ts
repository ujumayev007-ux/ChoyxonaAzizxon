import { Router } from 'express';
import { Prisma, RoleType } from '@prisma/client';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole, setAuthCookie } from '../middleware/auth';
import { hashPassword } from '../utils/password';
import { hashPin, verifyPin } from '../utils/pin';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
const roles = ['ADMIN', 'CASHIER', 'WAITER', 'KITCHEN'];
const avatars = ['person', 'chef', 'service', 'cashier', 'star', 'flower'];
const safeSelect = { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, avatar: true, updatedAt: true } as const;

router.get('/:id/history', async (req, res) => {
    try { res.json(await prisma.auditLog.findMany({ where: { entity: 'User', entityId: req.params.id }, take: 100, orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true } } } })); }
    catch { res.status(500).json({ message: 'Amallar tarixini yuklab bo‘lmadi' }); }
});
async function save(req: any, res: any) {
    const creating = !req.params.id;
    const { username, fullName, phone, role, password, pin, avatar, isActive, commissionPercent } = req.body || {};
    if (typeof username !== 'string' || !username.trim() || username.length > 50 || typeof fullName !== 'string' || !fullName.trim() || fullName.length > 100 ||
        typeof phone !== 'string' || phone.length > 50 || !roles.includes(role) ||
        (creating && typeof password !== 'string') || (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8 || password.length > 200)) ||
        (creating && !password) || (pin !== undefined && pin !== null && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) ||
        (avatar !== undefined && avatar !== null && !avatars.includes(avatar)) || (isActive !== undefined && typeof isActive !== 'boolean') ||
        (commissionPercent !== undefined && (!Number.isFinite(Number(commissionPercent)) || Number(commissionPercent) < 0 || Number(commissionPercent) > 100))) {
        res.status(400).json({ message: 'Xodim ma’lumotlari noto‘g‘ri. Parol kamida 8 belgi, PIN 4 raqam bo‘lsin' }); return;
    }
    try {
        const result = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707370)`;
            const old = creating ? null : await tx.user.findUnique({ where: { id: req.params.id }, select: safeSelect });
            if (!creating && !old) throw new Error('NOT_FOUND');
            if (old?.id === req.user.id && (role !== 'ADMIN' || isActive === false)) throw new Error('SELF');
            if (old?.role === 'ADMIN' && old.isActive && (role !== 'ADMIN' || isActive === false) &&
                await tx.user.count({ where: { role: 'ADMIN', isActive: true } }) <= 1) throw new Error('LAST_ADMIN');
            if (pin) {
                const others = await tx.user.findMany({ where: { ...(old ? { id: { not: old.id } } : {}), pinCodeHash: { not: null } }, select: { pinCodeHash: true } });
                for (const other of others) if (await verifyPin(pin, other.pinCodeHash!)) throw new Error('PIN_USED');
            }
            const data = { username: username.trim(), fullName: fullName.trim(), phone: phone.trim(), role: role as RoleType,
                ...(isActive !== undefined ? { isActive } : {}), ...(avatar !== undefined ? { avatar } : {}),
                ...(password ? { passwordHash: await hashPassword(password) } : {}),
                ...(pin !== undefined ? { pinCodeHash: pin === null ? null : await hashPin(pin) } : {}) };
            const user = creating ? await tx.user.create({ data: { ...data, passwordHash: data.passwordHash! }, select: safeSelect })
                : await tx.user.update({ where: { id: old!.id }, data, select: safeSelect });
            if (role === 'WAITER') await tx.waiterProfile.upsert({ where: { userId: user.id },
                create: { userId: user.id, phone: phone.trim(), commissionPercent: commissionPercent === undefined ? 10 : Number(commissionPercent) },
                update: { phone: phone.trim(), ...(commissionPercent !== undefined ? { commissionPercent: Number(commissionPercent) } : {}) } });
            if (role === 'CASHIER') await tx.cashierProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
            await tx.auditLog.create({ data: { userId: req.user.id, action: creating ? 'EMPLOYEE_CREATED' : 'EMPLOYEE_UPDATED', entity: 'User', entityId: user.id,
                oldValue: old ? JSON.stringify(old) : null, newValue: JSON.stringify({ ...user, passwordChanged: Boolean(password), pinChanged: pin !== undefined }) } });
            return user;
        }, { maxWait: 10000, timeout: 30000 });
        if (result.id === req.user.id) setAuthCookie(res, result);
        res.status(creating ? 201 : 200).json({ success: true, data: result });
    } catch (error) {
        const messages: Record<string, string> = { NOT_FOUND: 'Xodim topilmadi', SELF: 'O‘z admin hisobingizni o‘chira yoki rolini almashtira olmaysiz', LAST_ADMIN: 'Oxirgi faol admin saqlanishi kerak', PIN_USED: 'PIN boshqa xodimga biriktirilgan' };
        res.status(400).json({ message: error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'Login band' : messages[error instanceof Error ? error.message : ''] || 'Xodim saqlanmadi' });
    }
}
router.post('/', save);
router.put('/:id', save);
export default router;
