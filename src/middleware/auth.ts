import { Request, Response, NextFunction } from 'express';

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    // Autentifikatsiya tekshiruvi (hozircha ruxsat beramiz)
    (req as any).user = { id: '1', role: 'admin' };
    next();
};

export const requireRole = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        next();
    };
};
