import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../utils/db';
const router = Router();
router.use(async (req, res, next) => {
    try {
        const config = await prisma.printConfig.findUnique({ where: { id: 'default' } });
        const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
        const hash = createHash('sha256').update(token).digest('hex');
        if (!token || !config?.agentTokenHash || !timingSafeEqual(Buffer.from(hash), Buffer.from(config.agentTokenHash))) {
            res.status(401).json({ message: 'Printer ulash kaliti noto‘g‘ri' }); return;
        }
        next();
    } catch { res.status(503).json({ message: 'Printer xizmati vaqtincha ishlamayapti' }); }
});
router.post('/claim', async (_req, res) => {
    try {
        const job = await prisma.$transaction(async tx => {
            const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PrintJob" WHERE "jobType" IN ('KITCHEN','TEST') AND "status"='KUTILMOQDA' ORDER BY "createdAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
            for (const row of rows) {
                const candidate = await tx.printJob.findUniqueOrThrow({ where: { id: row.id } });
                if (candidate.orderId && (await tx.order.findUnique({ where: { id: candidate.orderId }, select: { status: true } }))?.status === 'BEKOR_QILINDI') {
                    await tx.printJob.update({ where: { id: candidate.id }, data: { status: 'BEKOR_QILINDI' } }); continue;
                }
                const payload = JSON.parse(candidate.payload);
                const printer = candidate.printerId
                    ? await tx.printer.findFirst({ where: { id: candidate.printerId, isActive: true } })
                    : await tx.printer.findFirst({ where: { isActive: true, OR: [
                        { categoryIds: { hasSome: payload.categoryIds || [] } },
                        { department: payload.department || '', categoryIds: { isEmpty: true } }
                    ] } });
                if (!printer) continue;
                await tx.printJob.update({ where: { id: candidate.id }, data: { status: 'CHOP_ETILMOQDA', printerId: printer.id } });
                return { id: candidate.id, payload, printer };
            }
            return null;
        }, { maxWait: 10000, timeout: 30000 });
        res.json({ job });
    } catch { res.status(500).json({ message: 'Chop etish navbatini olib bo‘lmadi' }); }
});
router.post('/:id/result', async (req, res) => {
    if (!['YUBORILDI', 'XATOLIK'].includes(req.body?.status)) { res.status(400).json({ message: 'Holat noto‘g‘ri' }); return; }
    try {
        await prisma.printJob.updateMany({ where: { id: req.params.id, jobType: { in: ['KITCHEN', 'TEST'] }, status: 'CHOP_ETILMOQDA' }, data: { status: req.body.status } });
        res.json({ success: true });
    } catch { res.status(500).json({ message: 'Chek holati saqlanmadi' }); }
});
export default router;
