// Windows'da: har bir o'rnatuvchini jim o'rnatadi, ilovani ishga tushiradi va haqiqiy ishlashini tekshiradi.
// Soxta server (port 3000) LAN topish (/api/system/discovery) va rol sahifasini taqlid qiladi.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert');
const roles = require('../desktop/roles');

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'dist-installers', 'release');
const installRoot = process.env.INSTALL_ROOT || path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'azizxon-apps');
const names = { admin: 'Admin', cashier: 'Kassa', waiter: 'Ofitsiant', kitchen: 'Oshxona', owner: 'Owner', tv: 'TV' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

const hits = new Set();
const server = http.createServer((req, res) => {
    hits.add(req.url);
    if (req.url.startsWith('/api/system/discovery')) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ app: 'choyxona', serverId: 'ci-server-1', name: 'CI Restoran', port: 3000 }));
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>${req.url}</title><body>CI ${req.url}</body>`);
});

async function windowState(port) {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:3000'));
    if (!page) return null;
    const version = await getJson(`http://127.0.0.1:${port}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const reply = await new Promise(res => {
        ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) res(d.result); };
        ws.send(JSON.stringify({ id: 1, method: 'Browser.getWindowForTarget', params: { targetId: page.id } }));
    });
    ws.close();
    return { url: page.url, state: reply.bounds.windowState };
}

(async () => {
    await new Promise(r => server.listen(3000, '127.0.0.1', r));
    let port = 9300;
    for (const [id, role] of Object.entries(roles)) {
        const name = names[id];
        const setup = path.join(release, `${name}-Setup.exe`);
        assert.ok(fs.existsSync(setup), `${name}: o'rnatuvchi yo'q`);
        assert.ok(fs.statSync(setup).size > 40 * 1024 * 1024, `${name}: o'rnatuvchi juda kichik`);
        const dir = path.join(installRoot, name);
        fs.rmSync(dir, { recursive: true, force: true });
        execFileSync(setup, ['/S', `/D=${dir}`], { stdio: 'inherit' });
        const exe = path.join(dir, `${name}.exe`);
        assert.ok(fs.existsSync(exe), `${name}.exe o'rnatilmadi`);
        const asar = path.join(dir, 'resources', 'app.asar');
        assert.ok(fs.statSync(asar).size > 10 * 1024, `${name}: app.asar bo'sh`);
        const packed = fs.readFileSync(asar).toString('latin1');
        assert.ok(packed.includes(`{"role":"${id}"}`), `${name}: role.json noto'g'ri`);
        assert.ok(fs.statSync(exe).size > 50 * 1024 * 1024, `${name}.exe haqiqiy Electron emas`);

        const p = ++port;
        const child = spawn(exe, [`--remote-debugging-port=${p}`], { stdio: 'ignore' });
        let state = null;
        for (let i = 0; i < 40 && !state; i++) {
            await sleep(1000);
            try { state = await windowState(p); } catch { /* hali ishga tushmoqda */ }
        }
        assert.ok(state, `${name}: ilova serverni topib sahifani ochmadi`);
        const expected = 'http://127.0.0.1:3000' + role.path;
        assert.strictEqual(state.url, expected, `${name}: noto'g'ri sahifa`);
        if (role.kiosk) assert.strictEqual(state.state, 'fullscreen', `${name}: to'liq ekran emas`);
        console.log(`OK ${name}: ${state.url} (${state.state})`);
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* tugagan */ }
        await sleep(1500);
    }
    server.close();
    console.log('Barcha 6 ilova tekshiruvdan o\'tdi');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
