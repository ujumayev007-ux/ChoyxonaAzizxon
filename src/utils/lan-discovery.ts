import dgram from 'dgram';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41234);
const PROBE = 'CHOYXONA_DISCOVER_V1';

export function getServerIdentity(port: number) {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const file = path.join(dir, 'server-id');
    let serverId = process.env.SERVER_ID || '';
    if (!serverId) {
        try { serverId = fs.readFileSync(file, 'utf8').trim(); } catch { /* yangi yaratiladi */ }
    }
    if (!serverId) {
        serverId = randomUUID();
        try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, serverId, { mode: 0o600 }); } catch { /* faqat xotirada */ }
    }
    return {
        app: 'choyxona',
        serverId,
        name: process.env.RESTAURANT_NAME || 'Choyxona',
        port,
        version: 1
    };
}

export function startLanDiscovery(port: number) {
    const identity = getServerIdentity(port);
    const payload = Buffer.from(JSON.stringify(identity));
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', err => console.error('LAN discovery xatosi:', err.message));
    socket.on('message', (msg, rinfo) => {
        if (msg.toString('utf8').trim() !== PROBE) return;
        socket.send(payload, rinfo.port, rinfo.address);
    });
    socket.bind(DISCOVERY_PORT, () => {
        try { socket.setBroadcast(true); } catch { /* ignore */ }
        const beacon = () => {
            const hasNet = Object.values(os.networkInterfaces()).some(list => (list || []).some(i => !i.internal && i.family === 'IPv4'));
            if (!hasNet) return;
            try { socket.send(payload, DISCOVERY_PORT, '255.255.255.255'); } catch { /* ignore */ }
        };
        const timer = setInterval(beacon, 5000);
        timer.unref();
    });
    return { identity, close: () => socket.close() };
}
