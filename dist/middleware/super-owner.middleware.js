"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperOwner = requireSuperOwner;
const super_owner_auth_service_1 = require("../services/super-owner-auth.service");
function requireSuperOwner(req, res, next) {
    const authHeader = req.headers.authorization;
    const cookieToken = req.headers.cookie?.split(';').find(c => c.trim().startsWith('super_owner_session='))?.split('=')[1];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Super Owner autentifikatsiyasi talab qilinadi' });
    }
    const session = (0, super_owner_auth_service_1.verifySuperOwnerToken)(token);
    if (!session) {
        return res.status(401).json({ success: false, message: 'Super Owner sessiyasi yaroqsiz yoki muddati o‘tgan' });
    }
    req.superOwner = session;
    next();
}
