import { Request, Response, NextFunction } from 'express';
import { getSubscription, getStatusSummary } from '../utils/license';

export async function subscriptionGuard(req: Request, res: Response, next: NextFunction) {
    const path = req.path;

    // Allowed paths even when locked:
    // 1. Owner endpoints & Owner UI
    // 2. Subscription verification & activation
    // 3. Static files & assets (CSS, JS, images, favicon)
    if (
        path.startsWith('/api/owner') ||
        path.startsWith('/owner') ||
        path === '/api/subscription/status' ||
        path === '/api/subscription/activate' ||
        path.startsWith('/js/') ||
        path.startsWith('/css/') ||
        path.startsWith('/images/') ||
        path.startsWith('/audio/') ||
        path.startsWith('/assets/') ||
        path === '/favicon.ico' ||
        path === '/favicon.svg'
    ) {
        return next();
    }

    try {
        const sub = await getSubscription();
        const summary = getStatusSummary(sub);

        if (summary.status === 'LOCKED' || summary.status === 'EXPIRED') {
            // If request is an API call, reject with 403 and lock details
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    code: 'SUBSCRIPTION_LOCKED',
                    message: summary.status === 'LOCKED' 
                        ? (summary.lockReason || 'Dastur ta’minotchi tomonidan qulflangan.')
                        : 'Dastur oylik obuna to‘lovi muddati tugagan.',
                    subscription: summary
                });
            }
        }

        // Attach summary to request for downstream handlers if needed
        (req as any).subscription = summary;
        next();
    } catch (error) {
        console.error('Subscription guard xatosi:', error);
        next();
    }
}

