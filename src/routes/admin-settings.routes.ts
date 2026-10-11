import { Router } from 'express';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { defaults, getSettings, saveSettings, settingsVersion, SettingKey } from '../utils/settings';
import { emitSocketEvent } from '../socket';
const router = Router();
router.use(authenticateToken, requireRole(['ADMIN']));
router.get('/health', async (_req, res) => {
    try {
        const [printer, telegram, backup, printConfig, token, printerSuccess, printerFailure, telegramSuccess, telegramFailure, backupSuccess, backupFailure] = await Promise.all([
            prisma.printJob.findFirst({ where: { jobType: { in: ['KITCHEN', 'TEST'] } }, orderBy: { createdAt: 'desc' }, select: { status:true, createdAt:true } }),
            prisma.telegramDelivery.findFirst({ orderBy: { createdAt: 'desc' }, select: { status:true, createdAt:true } }),
            prisma.dataBackup.findFirst({ orderBy: { createdAt: 'desc' }, select: { status:true, createdAt:true } }),
            prisma.printConfig.findUnique({ where: { id:'default' }, select: { agentTokenHash:true } }),
            prisma.appSetting.findUnique({ where: { key:'telegramSecret' }, select: { key:true } }),
            prisma.printJob.findFirst({ where: { jobType: { in:['KITCHEN','TEST'] }, status:'YUBORILDI' }, orderBy:{createdAt:'desc'}, select:{createdAt:true} }),
            prisma.printJob.findFirst({ where: { jobType: { in:['KITCHEN','TEST'] }, status:'XATOLIK' }, orderBy:{createdAt:'desc'}, select:{createdAt:true} }),
            prisma.telegramDelivery.findFirst({ where:{status:'YUBORILDI'}, orderBy:{createdAt:'desc'}, select:{createdAt:true} }),
            prisma.telegramDelivery.findFirst({ where:{status:'XATOLIK'}, orderBy:{createdAt:'desc'}, select:{createdAt:true} }),
            prisma.dataBackup.findFirst({ where:{status:'TAYYOR'}, orderBy:{createdAt:'desc'}, select:{createdAt:true} }),
            prisma.dataBackup.findFirst({ where:{status:'XATOLIK'}, orderBy:{createdAt:'desc'}, select:{createdAt:true} })
        ]);
        res.json({ checkedAt:new Date(), printer:{configured:Boolean(printConfig?.agentTokenHash),last:printer,lastSuccess:printerSuccess,lastFailure:printerFailure}, telegram:{configured:Boolean(token || process.env.TELEGRAM_BOT_TOKEN),last:telegram,lastSuccess:telegramSuccess,lastFailure:telegramFailure}, backup:{last:backup,lastSuccess:backupSuccess,lastFailure:backupFailure} });
    } catch { res.status(503).json({ message:'Xizmatlar holatini olib bo‘lmadi. Qayta tekshiring.' }); }
});
router.get('/alerts', async (_req, res) => {
    try { res.json(await prisma.systemAlert.findMany({ where: { resolvedAt: null }, take: 100, orderBy: { createdAt: 'desc' } })); }
    catch { res.status(500).json({ message: 'Ogohlantirishlar yuklanmadi' }); }
});
router.post('/alerts/:id/resolve', async (req, res) => {
    try {
        await prisma.$transaction(async tx => {
            await tx.systemAlert.update({ where: { id: req.params.id }, data: { resolvedAt: new Date() } });
            await tx.auditLog.create({ data: { userId: req.user!.id, action: 'ALERT_ACKNOWLEDGED', entity: 'SystemAlert', entityId: req.params.id } });
        }); res.json({ success: true });
    } catch { res.status(400).json({ message: 'Ogohlantirish yopilmadi' }); }
});
router.get('/', async (_req, res) => {
    try {
        const data = Object.fromEntries(await Promise.all((Object.keys(defaults) as SettingKey[]).map(async key => [key, await getSettings(prisma, key)])));
        res.json({ ...data, _versions: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, settingsVersion(value)])) });
    }
    catch { res.status(500).json({ message: 'Sozlamalar yuklanmadi' }); }
});
router.put('/:key', async (req, res) => {
    if (req.params.key === 'telegramReport' || !Object.hasOwn(defaults, req.params.key)) { res.status(404).json({ message: 'Sozlama topilmadi' }); return; }
    try {
        let version = '';
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(72707372)`;
            const expected = req.get('x-settings-version');
            if (expected && expected !== settingsVersion(await getSettings(tx, req.params.key as SettingKey))) throw Error('SETTINGS_CONFLICT');
            const revision = await saveSettings(tx, req.params.key as SettingKey, req.body, req.user!.id);
            version = settingsVersion(revision.value);
        }, { timeout: 30000 });
        emitSocketEvent('settings_updated', { key: req.params.key }); res.json({ success: true, version });
    } catch (error) {
        if (error instanceof Error && error.message === 'SETTINGS_CONFLICT') { res.status(409).json({ message: 'Boshqa admin bu sozlamalarni o‘zgartirdi. Yangilab, o‘zgarishlaringizni qayta tekshiring.' }); return; }
        res.status(400).json({ message: 'Sozlama qiymatlari noto‘g‘ri yoki saqlashda xatolik' });
    }
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
            if (revision.key === 'telegramReport' || !Object.hasOwn(defaults, revision.key)) throw Error();
            const expected = req.get('x-settings-version');
            if (expected && expected !== settingsVersion(await getSettings(tx, revision.key as SettingKey))) throw Error('SETTINGS_CONFLICT');
            await saveSettings(tx, revision.key as SettingKey, revision.previous, req.user!.id);
        }, { timeout: 30000 }); emitSocketEvent('settings_updated', {}); res.json({ success: true });
    } catch (error) {
        res.status(error instanceof Error && error.message === 'SETTINGS_CONFLICT' ? 409 : 400).json({ message: error instanceof Error && error.message === 'SETTINGS_CONFLICT' ? 'Sozlamalar o‘zgargan. Tarixni yangilab qayta tekshiring.' : 'Oldingi sozlamalarni tiklab bo‘lmadi' });
    }
});
export default router;
