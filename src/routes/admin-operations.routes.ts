import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { isIP } from 'net';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole, setAuthCookie } from '../middleware/auth';
import { hashPin, verifyPin } from '../utils/pin';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
router.get('/operations', async (_req, res) => {
    try {
        const [printers, categories, users, config, jobs] = await Promise.all([
            prisma.printer.findMany({ orderBy: { name: 'asc' } }), prisma.menuCategory.findMany({ orderBy: { name: 'asc' } }),
            prisma.user.findMany({ where: { role: { in: ['ADMIN', 'WAITER', 'CASHIER'] } }, select: { id: true, fullName: true, username: true, role: true, pinCodeHash: true } }),
            prisma.printConfig.findUnique({ where: { id: 'default' } }),
            prisma.printJob.findMany({ where: { jobType: 'KITCHEN' }, take: 30, orderBy: { createdAt: 'desc' }, select: { id: true, printerId: true, status: true, createdAt: true, order: { select: { orderNumber: true } } } })
        ]);
        res.json({ printers, categories, users: users.map(({ pinCodeHash, ...user }) => ({ ...user, hasPin: Boolean(pinCodeHash) })),
            config: { header: config?.header || 'ChoyxonaAzizxon', footer: config?.footer || '', agentConfigured: Boolean(config?.agentTokenHash) }, jobs });
    } catch { res.status(500).json({ message: 'Sozlamalarni yuklab bo‘lmadi' }); }
});
router.put('/users/:id/pin', async (req, res) => {
    const pin = req.body?.pin;
    if (pin !== null && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
        res.status(400).json({ message: 'PIN aynan 4 ta raqam bo‘lishi kerak' }); return;
    }
    try {
        const user = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707370)`;
            const current = await tx.user.findUnique({ where: { id: req.params.id } });
            if (!current || !['ADMIN', 'WAITER', 'CASHIER'].includes(current.role)) throw new Error('NOT_FOUND');
            if (pin !== null) {
                const others = await tx.user.findMany({ where: { id: { not: current.id }, pinCodeHash: { not: null } }, select: { pinCodeHash: true } });
                for (const other of others) if (await verifyPin(pin, other.pinCodeHash!)) throw new Error('DUPLICATE');
            }
            return tx.user.update({ where: { id: current.id }, data: { pinCodeHash: pin === null ? null : await hashPin(pin) }, select: { id: true, role: true, updatedAt: true } });
        }, { maxWait: 10000, timeout: 30000 });
        if (user.id === req.user!.id) setAuthCookie(res, user);
        res.json({ success: true });
    } catch (error) { res.status(400).json({ message: error instanceof Error && error.message === 'DUPLICATE' ? 'Bu PIN boshqa xodimga biriktirilgan' : 'PIN saqlanmadi. Foydalanuvchini tekshiring' }); }
});
router.put('/printers/:id', async (req, res) => {
    const { name, department, ipAddress, port, paperWidth, isActive, categoryIds, connectionType } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof department !== 'string' || !department.trim() || department.length > 100 ||
        typeof ipAddress !== 'string' || !ipAddress.trim() || ipAddress.length > 200 || !['TCP', 'WINDOWS'].includes(connectionType) ||
        (connectionType === 'TCP' && !isIP(ipAddress)) || !Number.isInteger(port) || port < 1 || port > 65535 ||
        ![58, 80].includes(paperWidth) || typeof isActive !== 'boolean' || !Array.isArray(categoryIds) || categoryIds.some(id => typeof id !== 'string')) {
        res.status(400).json({ message: 'Printer nomi, ulanish manzili, port va kategoriyalarni to‘g‘ri kiriting' }); return;
    }
    try {
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707371)`;
            const ids = [...new Set(categoryIds)] as string[];
            if (await tx.menuCategory.count({ where: { id: { in: ids } } }) !== ids.length) throw new Error('CATEGORY');
            const conflict = isActive && await tx.printer.findFirst({ where: { id: { not: req.params.id }, isActive: true, categoryIds: { hasSome: ids } } });
            if (conflict) throw new Error('CONFLICT');
            const data = { name: name.trim(), department: department.trim(), ipAddress: ipAddress.trim(), port, paperWidth, isActive, categoryIds: ids, connectionType };
            if (req.params.id === 'new') await tx.printer.create({ data });
            else await tx.printer.update({ where: { id: req.params.id }, data });
        }, { maxWait: 10000, timeout: 30000 });
        res.json({ success: true });
    } catch (error) { res.status(400).json({ message: error instanceof Error && error.message === 'CONFLICT' ? 'Kategoriya boshqa faol printerga biriktirilgan' : 'Printer saqlanmadi' }); }
});
router.put('/print-config', async (req, res) => {
    const { header, footer } = req.body || {};
    if (typeof header !== 'string' || typeof footer !== 'string' || header.length > 150 || footer.length > 250) { res.status(400).json({ message: 'Chek matni noto‘g‘ri' }); return; }
    try { await prisma.printConfig.upsert({ where: { id: 'default' }, create: { id: 'default', header, footer }, update: { header, footer } }); res.json({ success: true }); }
    catch { res.status(500).json({ message: 'Chek sozlamalari saqlanmadi' }); }
});
router.post('/print-agent-token', async (_req, res) => {
    try {
        const token = randomBytes(32).toString('hex'), agentTokenHash = createHash('sha256').update(token).digest('hex');
        await prisma.printConfig.upsert({ where: { id: 'default' }, create: { id: 'default', agentTokenHash }, update: { agentTokenHash } });
        res.json({ token });
    } catch { res.status(500).json({ message: 'Ulash kaliti yaratilmadi' }); }
});
router.post('/print-jobs/:id/retry', async (req, res) => {
    try {
        const result = await prisma.printJob.updateMany({ where: { id: req.params.id, jobType: 'KITCHEN', status: { in: ['XATOLIK', 'CHOP_ETILMOQDA'] } }, data: { status: 'KUTILMOQDA' } });
        res.json({ success: result.count > 0 });
    } catch { res.status(500).json({ message: 'Chek navbatga qaytarilmadi' }); }
});
export default router;
