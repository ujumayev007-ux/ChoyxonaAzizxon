"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.ServiceError = exports.closedServiceStatuses = void 0;
exports.servicePolicy = servicePolicy;
exports.authorizeService = authorizeService;
exports.assertOrderFresh = assertOrderFresh;
exports.assertEditable = assertEditable;
exports.aggregateItemStatus = aggregateItemStatus;
exports.allocateLineBudgets = allocateLineBudgets;
const client_1 = require("@prisma/client");
const settings_1 = require("./settings");
exports.closedServiceStatuses = ['TOLANDI', 'YAKUNLANDI', 'BEKOR_QILINDI', 'QAYTARILDI'];
class ServiceError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ServiceError = ServiceError;
const fail = (status, message) => { throw new ServiceError(status, message); };
exports.fail = fail;
async function servicePolicy(tx) {
    return { ...settings_1.defaults.waiterService, ...await (0, settings_1.getSettings)(tx, 'waiterService') };
}
async function authorizeService(tx, user, action, order) {
    const policy = await servicePolicy(tx);
    if (user.role === 'ADMIN')
        return policy;
    const roles = {
        assign: ['WAITER'], deliver: ['WAITER'], requestReturn: ['WAITER'], requestCancel: ['WAITER'],
        transfer: ['WAITER'], reassign: ['WAITER'], takePayment: ['WAITER', 'CASHIER'],
        review: ['CASHIER'], cancelReview: ['CASHIER', 'KITCHEN'], kitchen: ['KITCHEN'], read: ['WAITER', 'CASHIER', 'KITCHEN']
    };
    if (!roles[action]?.includes(user.role))
        (0, exports.fail)(403, 'Bu amal uchun ruxsat yo‘q');
    const key = action === 'review' ? 'cashierReview' : action === 'cancelReview' ? user.role === 'KITCHEN' ? 'kitchenCancel' : 'cashierReview' : action;
    if (!(action === 'takePayment' && user.role === 'CASHIER') && Object.hasOwn(policy, key) && !policy[key])
        (0, exports.fail)(403, 'Bu amal admin sozlamalarida o‘chirilgan');
    if (user.role === 'WAITER' && order) {
        const owner = order.waiterId || order.table?.assignedWaiterId;
        if (policy.scope === 'OWN' && owner && owner !== user.id)
            (0, exports.fail)(403, 'Bu buyurtma boshqa ofitsantga biriktirilgan');
        if (['deliver', 'requestReturn', 'requestCancel', 'transfer', 'reassign'].includes(action) && order.waiterId !== user.id)
            (0, exports.fail)(403, 'Faqat o‘zingizga biriktirilgan buyurtmada ishlang');
    }
    return policy;
}
function assertOrderFresh(order, expected) {
    if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)) || new Date(expected).getTime() !== new Date(order.updatedAt).getTime())
        (0, exports.fail)(409, 'Buyurtma yangilangan. Ma’lumotni yangilab, qayta tekshiring.');
}
function assertEditable(order) {
    if (exports.closedServiceStatuses.includes(order.status) || order.payments?.length || order.debt || order.recipesDeductedAt || order.paidAt)
        (0, exports.fail)(409, 'To‘lov boshlangan yoki yakunlangan buyurtmani o‘zgartirib bo‘lmaydi');
    if (order.processingById && order.processingAt && Date.now() - new Date(order.processingAt).getTime() <= 600000)
        (0, exports.fail)(409, 'Kassir buyurtmani qayta ishlamoqda');
}
function aggregateItemStatus(items, previous) {
    if (exports.closedServiceStatuses.includes(previous))
        return previous;
    const active = items.filter(i => i.status !== 'BEKOR_QILINDI');
    if (!active.length)
        return 'BEKOR_QILINDI';
    if (['QISMAN_TOLANDI', 'TOLOV_KUTILMOQDA', 'YANGI', 'KUTILMOQDA', 'ADMIN_TASDIGINI_KUTMOQDA'].includes(previous))
        return previous;
    if (active.every(i => i.status === 'STOLGA_YETKAZILDI'))
        return 'STOLGA_YETKAZILDI';
    if (active.every(i => ['TAYYOR', 'OLIB_KETILDI', 'STOLGA_YETKAZILDI'].includes(i.status)))
        return 'TAYYOR';
    if (active.some(i => i.status !== 'YANGI'))
        return 'TAYYORLANMOQDA';
    return 'TASDIQLANDI';
}
function allocateLineBudgets(order) {
    const lines = [...order.items].sort((a, b) => a.id.localeCompare(b.id));
    const base = lines.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0));
    if (!base.greaterThan(0))
        (0, exports.fail)(409, 'Qaytarish uchun taom summasi mavjud emas');
    const budgets = new Map();
    let cumulative = new client_1.Prisma.Decimal(0), allocated = new client_1.Prisma.Decimal(0);
    for (const line of lines) {
        cumulative = cumulative.plus(line.totalPrice);
        const next = new client_1.Prisma.Decimal(order.totalAmount).mul(cumulative).div(base).toDecimalPlaces(2);
        budgets.set(line.id, next.minus(allocated));
        allocated = next;
    }
    return budgets;
}
