"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.authenticateToken = void 0;
const authenticateToken = (req, res, next) => {
    // Autentifikatsiya tekshiruvi (hozircha ruxsat beramiz)
    req.user = { id: '1', role: 'admin' };
    next();
};
exports.authenticateToken = authenticateToken;
const requireRole = (roles) => {
    return (req, res, next) => {
        next();
    };
};
exports.requireRole = requireRole;
