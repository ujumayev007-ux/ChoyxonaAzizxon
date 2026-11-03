"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISCOVERY_PORT = void 0;
exports.getServerIdentity = getServerIdentity;
exports.startLanDiscovery = startLanDiscovery;
const dgram_1 = __importDefault(require("dgram"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
exports.DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41234);
const PROBE = 'CHOYXONA_DISCOVER_V1';
function getServerIdentity(port) {
    const dir = process.env.DATA_DIR || path_1.default.join(process.cwd(), 'data');
    const file = path_1.default.join(dir, 'server-id');
    let serverId = process.env.SERVER_ID || '';
    if (!serverId) {
        try {
            serverId = fs_1.default.readFileSync(file, 'utf8').trim();
        }
        catch { /* yangi yaratiladi */ }
    }
    if (!serverId) {
        serverId = (0, crypto_1.randomUUID)();
        try {
            fs_1.default.mkdirSync(dir, { recursive: true });
            fs_1.default.writeFileSync(file, serverId, { mode: 0o600 });
        }
        catch { /* faqat xotirada */ }
    }
    return {
        app: 'choyxona',
        serverId,
        name: process.env.RESTAURANT_NAME || 'Choyxona',
        port,
        version: 1
    };
}
function startLanDiscovery(port) {
    const identity = getServerIdentity(port);
    const payload = Buffer.from(JSON.stringify(identity));
    const socket = dgram_1.default.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', err => console.error('LAN discovery xatosi:', err.message));
    socket.on('message', (msg, rinfo) => {
        if (msg.toString('utf8').trim() !== PROBE)
            return;
        socket.send(payload, rinfo.port, rinfo.address);
    });
    socket.bind(exports.DISCOVERY_PORT, () => {
        try {
            socket.setBroadcast(true);
        }
        catch { /* ignore */ }
        const beacon = () => {
            const hasNet = Object.values(os_1.default.networkInterfaces()).some(list => (list || []).some(i => !i.internal && i.family === 'IPv4'));
            if (!hasNet)
                return;
            try {
                socket.send(payload, exports.DISCOVERY_PORT, '255.255.255.255');
            }
            catch { /* ignore */ }
        };
        const timer = setInterval(beacon, 5000);
        timer.unref();
    });
    return { identity, close: () => socket.close() };
}
