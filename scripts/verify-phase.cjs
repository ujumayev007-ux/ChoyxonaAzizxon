const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const steps = [
    ['Prisma sxemasini tekshirish', ['node_modules/prisma/build/index.js', 'validate']],
    ['Prisma klientini yaratish', ['node_modules/prisma/build/index.js', 'generate']],
    ['TypeScript build', ['node_modules/typescript/bin/tsc']],
    ['Kassir to‘lovlari', ['scripts/verify-cashier-payments.js']],
    ['Ofitsant va stol to‘lovlari', ['scripts/verify-waiter-payment-flow.js']],
    ['Buyurtmalar, printerlar, PIN va regressiya', ['--test',
        'scripts/verify-waiter-actions.cjs', 'scripts/verify-waiter-additions.cjs',
        'scripts/verify-printer-pin.cjs', 'scripts/verify-employees.cjs', 'scripts/verify-attendance.cjs', 'scripts/verify-sessions.cjs', 'scripts/verify-telegram-security.cjs', 'scripts/verify-inventory-settings.cjs', 'scripts/verify-backups.cjs', 'scripts/test-agent-regressions.cjs']],
    ['Printer ulash dasturi sintaksisi', ['--check', 'scripts/print-agent.cjs']],
    ['Nusxa o‘qish dasturi sintaksisi', ['--check', 'scripts/read-business-backup.cjs']]
];

for (const [label, args] of steps) {
    console.log(`\n${label}`);
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
        console.error(`Tekshiruv to‘xtadi: ${label}`);
        process.exit(result.status || 1);
    }
}
console.log('\nBarcha bosqich tekshiruvlari muvaffaqiyatli yakunlandi.');
