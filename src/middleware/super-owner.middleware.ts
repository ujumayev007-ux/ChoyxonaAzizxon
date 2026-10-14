import { Request, Response, NextFunction } from 'express';
import { verifySuperOwnerToken, SuperOwnerSession } from '../services/super-owner-auth.service';

declare global {
    namespace Express {
        interface Request {
            superOwner?: SuperOwnerSession;
        }
    }
}

export function requireSuperOwner(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const cookieToken = req.headers.cookie?.split(';').find(c => c.trim().startsWith('super_owner_session='))?.split('=')[1];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Super Owner autentifikatsiyasi talab qilinadi' });
    }

    const session = verifySuperOwnerToken(token);
    if (!session) {
        return res.status(401).json({ success: false, message: 'Super Owner sessiyasi yaroqsiz yoki muddati o‘tgan' });
    }

    req.superOwner = session;
    next();
}

