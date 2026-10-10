import fs from 'fs';
const p = 'C:/Users/PRESTIGE/Downloads/ChoyxonaAzizxon/src/routes/cashier.routes.ts';
let s = fs.readFileSync(p, 'utf8');
const func = sync function sendShiftCloseReport(cashierId: string, sessionId: string) {
  const [session, payments, expenses, refunds] = await Promise.all([
    prisma.cashSession.findUnique({ where: { id: sessionId }, select: { closedAt: true, startingBalance: true, expectedCash: true, actualCash: true, difference: true } }),
    prisma.payment.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true, method: true } }),
    prisma.expense.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true } }),
    prisma.refund.findMany({ where: { cashierId, createdAt: { gte: dayStartInTashkent() } }, select: { amount: true } })
  ]);
  const totalRevenue = payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const cashPayments = payments.filter(p => p.method === PaymentMethod.NAQD).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const cardPayments = payments.filter(p => p.method === PaymentMethod.PLASTIK).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const electronicPayments = payments.filter(p => p.method === PaymentMethod.ELEKTRON).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  const totalExpenses = expenses.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
  const totalRefunds = refunds.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  const lines = [
    \Smena yopilgan: \\,
    \Boshlang'ich balans: \\,
    \Kutilayotgan naqd: \\,
    \Amaldagi naqd: \\,
    \Farq: \\,
    \Umumiy tushum: \\,
    \Naqd to'lovlar: \\,
    \Plastik to'lovlar: \\,
    \Elektron to'lovlar: \\,
    \Xarajatlar: \\,
    \Qaytarishlar: \\
  ];
  await sendToActiveSubscribers(formatTelegramMessage('Smena hisobi', lines));
}
;
s = s + '\n' + func;
fs.writeFileSync(p, s);
console.log('ok');
