const path = require('node:path');
const { spawnSync } = require('node:child_process');

function migrationUrl(env) {
    const value = env.DIRECT_URL || env.DATABASE_URL;
    if (!value) throw new Error('Migratsiya uchun DATABASE_URL yoki DIRECT_URL kerak');
    let url;
    try { url = new URL(value); }
    catch { throw new Error('Baza ulanish manzili noto‘g‘ri'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error('Migratsiya uchun PostgreSQL ulanishi kerak');
    }
    // Neon uses the same credentials and database on its direct endpoint.
    if (url.hostname.endsWith('.neon.tech')) {
        url.hostname = url.hostname.replace(/-pooler(?=\.)/, '');
        url.searchParams.delete('pgbouncer');
    }
    return url.toString();
}

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    require('dotenv').config({ path: path.join(root, '.env') });
    try {
        const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
            cwd: root,
            env: { ...process.env, DATABASE_URL: migrationUrl(process.env) },
            stdio: 'inherit'
        });
        if (result.error) throw new Error('Migratsiya jarayonini ishga tushirib bo‘lmadi');
        process.exitCode = result.status ?? 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { migrationUrl };
