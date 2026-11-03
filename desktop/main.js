const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const roles = require('./roles');
const { findServer } = require('./discovery');

app.commandLine.appendSwitch('touch-events', 'enabled');

function getRoleId() {
    try {
        const packaged = JSON.parse(fs.readFileSync(path.join(__dirname, 'role.json'), 'utf8')).role;
        if (roles[packaged]) return packaged;
    } catch { /* dev rejim */ }
    const arg = process.argv.find(a => a.startsWith('--role='));
    const id = (arg ? arg.split('=')[1] : process.env.APP_ROLE || 'admin').toLowerCase();
    return roles[id] ? id : 'admin';
}

const role = roles[getRoleId()];
app.setName(`Azizxon ${role.title}`);
const configFile = () => path.join(app.getPath('userData'), 'connection.json');
const loadConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } };
const saveConfig = cfg => { try { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2)); } catch { /* ignore */ } };

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let currentUrl = null;
let status = 'searching';
let failures = 0;
let busy = false;

const STATUS_TEXT = {
    searching: ['#f59e0b', 'Server qidirilmoqda...'],
    online: ['#22c55e', 'Ulangan'],
    offline: ['#ef4444', 'Aloqa yo\'q — qayta ulanmoqda']
};

function paintStatus() {
    if (!win || win.isDestroyed()) return;
    const [color, text] = STATUS_TEXT[status];
    const js = `(()=>{let e=document.getElementById('__cx_status');if(!e){e=document.createElement('div');e.id='__cx_status';e.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483647;padding:4px 10px;border-radius:12px;font:12px system-ui;background:rgba(0,0,0,.75);color:#fff;pointer-events:none';document.body&&document.body.appendChild(e);}e.innerHTML='<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${color}"></span>${text}';})()`;
    win.webContents.executeJavaScript(js).catch(() => {});
}

function setStatus(s) { status = s; paintStatus(); }

function showMessage(html) {
    const page = `<!DOCTYPE html><html lang="uz"><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f19;color:#f1f5f9;font-family:system-ui;text-align:center">${html}</body></html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    currentUrl = null;
}

function showPicker(list) {
    const items = list.map(s => `<button style="display:block;width:100%;margin:8px 0;padding:18px;font-size:20px;border-radius:12px;border:0;background:#f59e0b" onclick="window.desktopApp.chooseServer('${s.serverId.replace(/[^a-f0-9-]/gi, '')}')">${String(s.name).replace(/[<>&"']/g, '')}</button>`).join('');
    showMessage(`<div style="max-width:420px;width:100%"><h2>Restoranni tanlang</h2><p>Bir nechta restoran topildi. Birinchi ulanishda o'zingiznikini tanlang.</p>${items}</div>`);
}

async function connect() {
    if (busy) return;
    busy = true;
    try {
        const cfg = loadConfig();
        const { server, all } = await findServer({ pinnedServerId: cfg.serverId, lastUrl: cfg.lastUrl });
        if (!server) {
            if (!cfg.serverId && all.length > 1) { showPicker(all); return; }
            if (currentUrl) { failures++; if (failures >= 2) setStatus('offline'); } else {
                showMessage('<div><div style="font-size:48px">📡</div><h2>Restoran serveri qidirilmoqda...</h2><p style="color:#94a3b8">Qurilma serverga bir xil Wi-Fi/LAN orqali ulangan bo\'lishi kerak.</p></div>');
            }
            return;
        }
        failures = 0;
        if (!cfg.serverId) saveConfig({ ...cfg, serverId: server.serverId, name: server.name });
        saveConfig({ ...loadConfig(), lastUrl: server.url });
        const target = server.url + role.path;
        if (!currentUrl || new URL(currentUrl).origin !== new URL(server.url).origin) {
            currentUrl = target;
            await win.loadURL(target).catch(() => { currentUrl = null; });
        }
        setStatus('online');
    } finally { busy = false; }
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 800, minWidth: 800, minHeight: 600,
        title: `Azizxon ${role.title}`,
        fullscreen: role.kiosk, kiosk: role.kiosk, autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    if (!role.kiosk) win.maximize();
    win.webContents.on('did-finish-load', paintStatus);
    win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3 && url.startsWith('http')) { currentUrl = null; setStatus('offline'); } });
    win.on('closed', () => { win = null; });
    app.setLoginItemSettings({ openAtLogin: role.autoStart });
    showMessage('<div><div style="font-size:48px">📡</div><h2>Restoran serveri qidirilmoqda...</h2></div>');
    connect();
    setInterval(connect, 4000);
}

ipcMain.handle('get-app-role', () => role.id);
ipcMain.handle('get-connection-status', () => ({ status, url: currentUrl }));
ipcMain.handle('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('choose-server', async (_e, serverId) => {
    const { all } = await findServer({});
    const s = all.find(x => x.serverId === String(serverId));
    if (s) { saveConfig({ ...loadConfig(), serverId: s.serverId, name: s.name, lastUrl: s.url }); connect(); }
});

app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
