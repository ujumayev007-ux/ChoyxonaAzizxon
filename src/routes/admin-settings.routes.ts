import { Router } from 'express';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { defaults, getSettings, saveSettings, SettingKey } from '../utils/settings';
import { emitSocketEvent } from '../socket';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
router.get('/', async (_req, res) => {
    try { res.json(Object.fromEntries(await Promise.all((Object.keys(defaults) as SettingKey[]).map(async key => [key, await getSettings(prisma, key)])))); }
    catch { res.status(500).json({ message: 'Sozlamalar yuklanmadi' }); }
});
router.put('/:key', async (req, res) => {
    if (!Object.hasOwn(defaults, req.params.key)) { res.status(404).json({ message: 'Sozlama topilmadi' }); return; }
    try {
        await prisma.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707372)`; await saveSettings(tx, req.params.key as SettingKey, req.body, req.user!.id); }, { timeout: 30000 });
        emitSocketEvent('settings_updated', { key: req.params.key }); res.json({ success: true });
    } catch { res.status(400).json({ message: 'Sozlama qiymatlari noto‘g‘ri yoki saqlashda xatolik' }); }
});
router.get('/history', async (_req, res) => {
    try {
        const rows = await prisma.settingRevision.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
        const actors = await prisma.user.findMany({ where: { id: { in: rows.map(row => row.actorId) } }, select: { id: true, fullName: true } });
        res.json(rows.map(row => ({ ...row, actorName: actors.find(actor => actor.id === row.actorId)?.fullName })));
    }
    catch { res.status(500).json({ message: 'Sozlamalar tarixi yuklanmadi' }); }
});
router.post('/history/:id/restore', async (req, res) => {
    try {
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707372)`;
            const revision = await tx.settingRevision.findUniqueOrThrow({ where: { id: req.params.id } });
            if (!Object.hasOwn(defaults, revision.key)) throw Error();
            await saveSettings(tx, revision.key as SettingKey, revision.previous, req.user!.id);
        }, { timeout: 30000 }); emitSocketEvent('settings_updated', {}); res.json({ success: true });
    } catch { res.status(400).json({ message: 'Oldingi sozlamalarni tiklab bo‘lmadi' }); }
});
export default router;
