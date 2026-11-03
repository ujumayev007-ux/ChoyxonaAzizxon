const dgram = require('dgram');
const http = require('http');
const os = require('os');

const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41234);
const PROBE = 'CHOYXONA_DISCOVER_V1';

function broadcastAddresses() {
    const out = new Set(['255.255.255.255']);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) {
            if (i.family !== 'IPv4' || i.internal) continue;
            const ip = i.address.split('.').map(Number);
            const mask = i.netmask.split('.').map(Number);
            out.add(ip.map((b, n) => (b | (~mask[n] & 255))).join('.'));
        }
    }
    return [...out];
}

function parseIdentity(raw) {
    try {
        const d = JSON.parse(raw);
        if (d && d.app === 'choyxona' && typeof d.serverId === 'string' && d.serverId && Number.isInteger(d.port)) return d;
    } catch { /* noto'g'ri javob */ }
    return null;
}

// UDP orqali LAN'dagi serverlarni qidiradi
function discoverUdp(timeoutMs = 1500, port = DISCOVERY_PORT, targets) {
    return new Promise(resolve => {
        const found = new Map();
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const finish = () => { try { socket.close(); } catch { /* yopilgan */ } resolve([...found.values()]); };
        socket.on('error', finish);
        socket.on('message', (msg, rinfo) => {
            const id = parseIdentity(msg.toString('utf8'));
            if (id) found.set(id.serverId, { ...id, host: rinfo.address, url: `http://${rinfo.address}:${id.port}` });
        });
        socket.bind(0, () => {
            try { socket.setBroadcast(true); } catch { /* ignore */ }
            const buf = Buffer.from(PROBE);
            for (const addr of targets || broadcastAddresses()) socket.send(buf, port, addr, () => {});
        });
        setTimeout(finish, timeoutMs);
    });
}

// Berilgan manzilni HTTP orqali tekshiradi (oxirgi ma'lum server / shu kompyuter)
function probeHttp(url, timeoutMs = 1500) {
    return new Promise(resolve => {
        let u;
        try { u = new URL('/api/system/discovery', url); } catch { return resolve(null); }
        const req = http.get(u, { timeout: timeoutMs }, res => {
            let body = '';
            res.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
            res.on('end', () => {
                const id = parseIdentity(body);
                resolve(id ? { ...id, host: u.hostname, url: `${u.protocol}//${u.host}` } : null);
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

// Faqat ruxsat berilgan (mos serverId) serverni qaytaradi; hech qachon boshqa restoranga ulanmaydi
async function findServer({ pinnedServerId, lastUrl, udpPort, udpTargets, timeoutMs } = {}) {
    const candidates = new Map();
    const add = s => { if (s) candidates.set(s.serverId, s); };
    const [udp, last, local] = await Promise.all([
        discoverUdp(timeoutMs, udpPort, udpTargets),
        lastUrl ? probeHttp(lastUrl) : null,
        probeHttp('http://127.0.0.1:3000')
    ]);
    udp.forEach(add); add(last); add(local);
    const all = [...candidates.values()];
    if (pinnedServerId) return { server: all.find(s => s.serverId === pinnedServerId) || null, all };
    return { server: all.length === 1 ? all[0] : null, all };
}

module.exports = { discoverUdp, probeHttp, findServer, broadcastAddresses, DISCOVERY_PORT };
