const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient, RoleType } = require('@prisma/client');
const { randomBytes, scrypt } = require('crypto');
const prisma = new PrismaClient();
const BASE = 'http://localhost:3000';
const TEMP_USER = `cookie_probe_${Date.now()}`;
const TEMP_PASS = 'CookieProbePass12345';
function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => scrypt(password, salt, 64, (e, dk) => e ? reject(e) : resolve(`${salt}:${dk.toString('hex')}`)));
}
(async () => {
    let id = null;
    try {
        id = (await prisma.user.create({ data: { username: TEMP_USER, passwordHash: await hashPassword(TEMP_PASS), fullName: 'Cookie Probe', role: RoleType.ADMIN }, select: { id: true } })).id;
        const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: TEMP_USER, password: TEMP_PASS }) });
        console.log('login status', login.status);
        const rawHeader = login.headers.get('set-cookie');
        console.log('raw set-cookie header:', JSON.stringify(rawHeader));
        // Node exposes multiple Set-Cookie headers two ways: `getSetCookie()` (Node 20+/
        // undici) and the legacy comma-joined single header. Fall back to the latter so
        // this probe works on every runtime, including older deploy targets.
        const all = typeof login.headers.getSetCookie === 'function'
            ? login.headers.getSetCookie()
            : rawHeader ? rawHeader.split(/, (?=[^;=]+=)/) : [];
        console.log('getSetCookie():', JSON.stringify(all));
        // Forward only real session cookies; drop cleared pairs such as
        // `restaurant_admin_terminal=` whose empty value would shadow the session.
        const cookieHeader = all
            .map(v => v.split(';')[0])
            .filter(pair => pair.includes('=') && pair.indexOf('=') < pair.length - 1)
            .join('; ');
        console.log('cookie header sent back:', JSON.stringify(cookieHeader));
        const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookieHeader } });
        console.log('me status', me.status, await me.text());
    } catch (e) {
        console.error('error', e);
        process.exitCode = 1;
    } finally {
        if (id) await prisma.user.deleteMany({ where: { id } });
        await prisma.$disconnect();
    }
})();
