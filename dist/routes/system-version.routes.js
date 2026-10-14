"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATEST_RELEASE_INFO = exports.CURRENT_RELEASE_DATE = exports.CURRENT_SYSTEM_VERSION = void 0;
const express_1 = require("express");
const db_1 = require("../utils/db");
const router = (0, express_1.Router)();
// Current installed application version
exports.CURRENT_SYSTEM_VERSION = '2.1.0';
exports.CURRENT_RELEASE_DATE = '2026-10-14';
exports.LATEST_RELEASE_INFO = {
    version: '2.1.0',
    releaseDate: '2026-10-14',
    title: 'ChoyxonaAzizxon v2.1.0 — Tijoriy SaaS va Zamonaviy Desktop Ekotizimi',
    changelog: [
        'Yangi: Dastur egasi (Owner) paneli va masofaviy qulflash (Kill-switch)',
        'Yangi: Oylik obuna to‘lovi hisoblagichi va xavfsiz litsenziya kaliti tizimi',
        'Yangi: Admin, Kassa va Ofitsiant uchun mustaqil .exe installerlar',
        'Yaxshilandi: Baza va tizim yangilanganda barcha eski ma’lumotlar (buyurtmalar, qarzlar, ombor) 100% xavfsiz saqlanadi',
        'Yaxshilandi: Kassa smenalari va hisobotlardagi daqiqa hisobi to‘g‘rilandi'
    ],
    downloadUrl: '/downloads/Azizxon-Setup.exe',
    isMandatory: false
};
router.get('/version', async (_req, res) => {
    try {
        // Check if there is an update notification configured in AppSetting
        const remoteConfig = await db_1.prisma.appSetting.findUnique({
            where: { key: 'system_update' }
        });
        const updateData = remoteConfig?.value || exports.LATEST_RELEASE_INFO;
        const hasUpdate = isNewerVersion(updateData.version, exports.CURRENT_SYSTEM_VERSION);
        res.json({
            success: true,
            currentVersion: exports.CURRENT_SYSTEM_VERSION,
            releaseDate: exports.CURRENT_RELEASE_DATE,
            hasUpdate,
            latestRelease: updateData,
            dataSafetyNotice: 'Diqqat: Yangilanish jarayonida barcha buyurtmalar, qarzlar, kassalar va ombor ma’lumotlaringiz to‘liq saqlanadi.'
        });
    }
    catch (error) {
        res.json({
            success: true,
            currentVersion: exports.CURRENT_SYSTEM_VERSION,
            releaseDate: exports.CURRENT_RELEASE_DATE,
            hasUpdate: false,
            latestRelease: exports.LATEST_RELEASE_INFO
        });
    }
});
function isNewerVersion(latest, current) {
    const lParts = latest.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = current.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if (lParts[i] > cParts[i])
            return true;
        if (lParts[i] < cParts[i])
            return false;
    }
    return false;
}
exports.default = router;
