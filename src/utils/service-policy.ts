import { Prisma, OrderStatus } from '@prisma/client';
import { defaults, getSettings } from './settings';

export const closedServiceStatuses: OrderStatus[] = ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'];
export class ServiceError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new ServiceError(status, message); };
export async function servicePolicy(tx: Prisma.TransactionClient) {
    return { ...defaults.waiterService, ...await getSettings(tx, 'waiterService') };
}
export async function authorizeService(tx: Prisma.TransactionClient, user: { id: string; role: string }, action: string, order?: any) {
    const policy = await servicePolicy(tx);
    if (user.role === 'ADMIN') return policy;
    const roles: Record<string, string[]> = {
        assign: ['WAITER'], deliver: ['WAITER'], requestReturn: ['WAITER'], requestCancel: ['WAITER'],
        transfer: ['WAITER'], reassign: ['WAITER'], takePayment: ['WAITER', 'CASHIER'],
        review: ['CASHIER'], cancelReview: ['CASHIER', 'KITCHEN'], kitchen: ['KITCHEN'], read: ['WAITER', 'CASHIER', 'KITCHEN']
    };
    if (!roles[action]?.includes(user.role)) fail(403, 'Bu amal uchun ruxsat yo‘q');
    const key = action === 'review' ? 'cashierReview' : action === 'cancelReview' ? user.role === 'KITCHEN' ? 'kitchenCancel' : 'cashierReview' : action;
    if (!(action === 'takePayment' && user.role === 'CASHIER') && Object.hasOwn(policy, key) && !policy[key]) fail(403, 'Bu amal admin sozlamalarida o‘chirilgan');
    if (user.role === 'WAITER' && order) {
        const owner = order.waiterId || order.table?.assignedWaiterId;
        if (policy.scope === 'OWN' && owner && owner !== user.id) fail(403, 'Bu buyurtma boshqa ofitsantga biriktirilgan');
        if (['deliver', 'requestReturn', 'requestCancel', 'transfer', 'reassign'].includes(action) && order.waiterId !== user.id) fail(403, 'Faqat o‘zingizga biriktirilgan buyurtmada ishlang');
    }
    return policy;
}
export function assertOrderFresh(order: any, expected: unknown) {
    if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)) || new Date(expected).getTime() !== new Date(order.updatedAt).getTime()) fail(409, 'Buyurtma yangilangan. Ma’lumotni yangilab, qayta tekshiring.');
}
export function assertEditable(order: any) {
    if (closedServiceStatuses.includes(order.status) || order.payments?.length || order.debt || order.recipesDeductedAt || order.paidAt) fail(409, 'To‘lov boshlangan yoki yakunlangan buyurtmani o‘zgartirib bo‘lmaydi');
    if (order.processingById && order.processingAt && Date.now() - new Date(order.processingAt).getTime() <= 600000) fail(409, 'Kassir buyurtmani qayta ishlamoqda');
}
export function aggregateItemStatus(items: any[], previous: string): any {
    if (closedServiceStatuses.includes(previous as OrderStatus)) return previous;
    const active = items.filter(i => i.status !== 'BEKOR_QILINDI');
    if (!active.length) return 'BEKOR_QILINDI';
    if (['QISMAN_TOLANDI', 'TOLOV_KUTILMOQDA', 'YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(previous)) return previous;
    if (active.every(i => i.status === 'STOLGA_YETKAZILDI')) return 'STOLGA_YETKAZILDI';
    if (active.every(i => ['TAYYOR', 'OLIB_KETILDI', 'STOLGA_YETKAZILDI'].includes(i.status))) return 'TAYYOR';
    if (active.some(i => i.status !== 'YANGI')) return 'TAYYORLANMOQDA';
    return 'TASDIQLANDI';
}
export function allocateLineBudgets(order: { items: any[]; totalAmount: any }) {
    const lines = [...order.items].sort((a, b) => a.id.localeCompare(b.id));
    const base = lines.reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0));
    if (!base.greaterThan(0)) fail(409, 'Qaytarish uchun taom summasi mavjud emas');
    const budgets = new Map<string, Prisma.Decimal>();
    let cumulative = new Prisma.Decimal(0), allocated = new Prisma.Decimal(0);
    for (const line of lines) {
        cumulative = cumulative.plus(line.totalPrice);
        const next = new Prisma.Decimal(order.totalAmount).mul(cumulative).div(base).toDecimalPlaces(2);
        budgets.set(line.id, next.minus(allocated)); allocated = next;
    }
    return budgets;
}
