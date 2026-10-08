/* Temporary end-to-end verification helper.
 * Creates a throwaway ADMIN with a known password, runs the full
 * login -> /me -> rooms -> table create -> table delete -> room delete flow,
 * then removes the throwaway admin. Never touches production data.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient, RoleType } = require('@prisma/client');
const { randomBytes, scrypt, timingSafeEqual } = require('crypto');

const prisma = new PrismaClient();
const TEMP_USER = `e2e_probe_${Date.now()}`;
const TEMP_PASS = `Probe${randomBytes(8).toString('hex')}!`;
const BASE = 'http://localhost:3000';

function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (error, derivedKey) => {
            if (error) return reject(error);
            resolve(`${salt}:${derivedKey.toString('hex')}`);
        });
    });
}

async function http(method, url, { cookie, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(BASE + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual'
    });
    const rawSetCookie = res.headers.get('set-cookie');
    // `getSetCookie()` is only present on Node 20+/undici runtimes. The legacy single
    // header is comma-joined, so split it back apart to keep the probe portable.
    const setCookie = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : rawSetCookie ? rawSetCookie.split(/, (?=[^;=]+=)/) : [];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text, setCookie };
}

(async () => {
    let createdUserId = null;
    let createdRoomId = null;
    try {
        createdUserId = (await prisma.user.create({
            data: {
                username: TEMP_USER,
                passwordHash: await hashPassword(TEMP_PASS),
                fullName: 'E2E Probe Admin',
                role: RoleType.ADMIN
            },
            select: { id: true }
        })).id;
        console.log(`[setup] temporary admin ${TEMP_USER} created`);

        const login = await http('POST', '/api/auth/login', { body: { username: TEMP_USER, password: TEMP_PASS } });
        console.log(`[login] status=${login.status} body=${login.text}`);
        // Only forward the real session cookie. A login response also carries a cleared
        // `restaurant_admin_terminal=` cookie; sending its empty value would shadow the
        // active session on runtimes that do not strip empty cookie pairs.
        const cookie = (login.setCookie || [])
            .map(value => value.split(';')[0])
            .filter(pair => pair.includes('=') && pair.indexOf('=') < pair.length - 1)
            .join('; ');
        console.log(`[login] cookieReceived=${Boolean(cookie)}`);

        const me = await http('GET', '/api/auth/me', { cookie });
        console.log(`[me] status=${me.status} body=${me.text}`);

        const roomName = `E2E Xona ${Date.now()}`;
        const room = await http('POST', '/api/rooms', { cookie, body: { name: roomName } });
        console.log(`[room create] status=${room.status} body=${room.text}`);
        createdRoomId = room.json?.data?.id || null;

        let createdTableId = null;
        if (createdRoomId) {
            const table = await http('POST', '/api/tables', { cookie, body: { number: '7', roomId: createdRoomId } });
            console.log(`[table create] status=${table.status} body=${table.text}`);
            createdTableId = table.json?.data?.id || null;

            const rooms = await http('GET', '/api/rooms', { cookie });
            const listed = Array.isArray(rooms.json) ? rooms.json : [];
            const found = listed.find(r => r.id === createdRoomId);
            console.log(`[rooms list] status=${rooms.status} rooms=${listed.length} containsNewRoom=${Boolean(found)} tablesInNewRoom=${found ? found.tables.length : 0}`);

            if (createdTableId) {
                const del = await http('DELETE', `/api/tables/${createdTableId}`, { cookie });
                console.log(`[table delete] status=${del.status} body=${del.text}`);
                const rooms2 = await http('GET', '/api/rooms', { cookie });
                const found2 = (Array.isArray(rooms2.json) ? rooms2.json : []).find(r => r.id === createdRoomId);
                console.log(`[verify table deleted] tablesInNewRoom=${found2 ? found2.tables.length : 'room-missing'}`);
            }
        }

        if (createdRoomId) {
            const delRoom = await http('DELETE', `/api/rooms/${createdRoomId}`, { cookie });
            console.log(`[room delete] status=${delRoom.status} body=${delRoom.text}`);
            createdRoomId = null;
        }
    } catch (error) {
        console.error('[error]', error);
        process.exitCode = 1;
    } finally {
        if (createdRoomId) {
            await prisma.table.deleteMany({ where: { roomId: createdRoomId } });
            await prisma.room.deleteMany({ where: { id: createdRoomId } });
            console.log('[cleanup] removed leftover e2e room');
        }
        if (createdUserId) {
            await prisma.user.deleteMany({ where: { id: createdUserId } });
            console.log('[cleanup] removed temporary admin');
        }
        await prisma.$disconnect();
    }
})();
