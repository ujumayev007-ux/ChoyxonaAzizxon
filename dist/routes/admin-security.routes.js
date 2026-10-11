"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../utils/db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)(['ADMIN']));
router.get('/sessions', async (_req, res) => {
    try {
        res.json(await db_1.prisma.authSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { fullName: true, role: true } } }, orderBy: { lastSeenAt: 'desc' }, take: 200 }));
    }
    catch {
        res.status(500).json({ message: 'Sessiyalar yuklanmadi' });
    }
});
router.post('/sessions/:id/revoke', async (req, res) => {
    try {
        await db_1.prisma.$transaction(async (tx) => {
            const session = await tx.authSession.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
            await tx.auditLog.create({ data: { userId: req.user.id, action: 'SESSION_REVOKED', entity: 'AuthSession', entityId: session.id, newValue: JSON.stringify({ employeeId: session.userId }) } });
        });
        res.json({ success: true });
    }
    catch {
        res.status(400).json({ message: 'Sessiya yakunlanmadi' });
    }
});
router.get('/audit', async (req, res) => {
    try {
        const rows = await db_1.prisma.auditLog.findMany({ where: { ...(typeof req.query.entity === 'string' && req.query.entity ? { entity: req.query.entity } : {}) },
            orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, action: true, entity: true, entityId: true, createdAt: true, user: { select: { fullName: true } } } });
        res.json(rows);
    }
    catch {
        res.status(500).json({ message: 'Audit tarixi yuklanmadi' });
    }
});
exports.default = router;
