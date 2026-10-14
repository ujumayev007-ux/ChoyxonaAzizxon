const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Config o‘qishda xatolik:', e);
    }
    return { serverUrl: 'http://localhost:3000', kioskMode: {} };
}

function saveConfig(newConfig) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('Config saqlashda xatolik:', e);
    }
}

// Determine role from args or env: admin, cashier, waiter
function getRole() {
    const arg = process.argv.find(a => a.startsWith('--role='));
    if (arg) return arg.split('=')[1].toLowerCase();
    if (process.env.APP_ROLE) return process.env.APP_ROLE.toLowerCase();
    return 'admin';
}

const role = getRole();
const roleConfig = {
    admin: {
        title: 'ChoyxonaAzizxon — Admin Boshqaruv Paneli',
        path: '/admin',
        width: 1440,
        height: 900
    },
    cashier: {
        title: 'ChoyxonaAzizxon — Kassa (POS) Terminali',
        path: '/cashier',
        width: 1280,
        height: 800
    },
    waiter: {
        title: 'ChoyxonaAzizxon — Ofitsiant Terminali',
        path: '/waiter',
        width: 1200,
        height: 800
    }
}[role] || {
    title: 'ChoyxonaAzizxon',
    path: '/admin',
    width: 1280,
    height: 800
};

let mainWindow = null;

function createWindow() {
    const config = loadConfig();
    const isKiosk = Boolean(config.kioskMode && config.kioskMode[role]);

    mainWindow = new BrowserWindow({
        width: roleConfig.width,
        height: roleConfig.height,
        minWidth: 1024,
        minHeight: 700,
        title: roleConfig.title,
        kiosk: isKiosk,
        fullscreen: isKiosk,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const targetUrl = `${config.serverUrl.replace(/\/$/, '')}${roleConfig.path}`;
    loadAppUrl(targetUrl);

    mainWindow.webContents.on('did-fail-load', () => {
        showConnectionErrorPage();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function loadAppUrl(url) {
    console.log(`[Desktop] Yuklanmoqda: ${url}`);
    mainWindow.loadURL(url).catch(() => {
        showConnectionErrorPage();
    });
}

function showConnectionErrorPage() {
    const config = loadConfig();
    const errorHtml = `
    <!DOCTYPE html>
    <html lang="uz">
    <head>
        <meta charset="UTF-8">
        <title>Ulanish xatosi — ChoyxonaAzizxon</title>
        <style>
            body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .card { background: #131b2e; border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
            h2 { color: #f59e0b; margin-top: 0; font-size: 22px; }
            p { font-size: 13px; color: #94a3b8; line-height: 1.5; }
            input { width: 100%; padding: 12px 14px; background: #060913; border: 1px solid #334155; border-radius: 12px; color: #fff; font-size: 13px; margin: 16px 0; box-sizing: border-box; outline: none; }
            input:focus { border-color: #f59e0b; }
            .btn { display: inline-block; width: 100%; padding: 13px; background: #f59e0b; color: #000; font-weight: bold; border: none; border-radius: 12px; font-size: 13px; cursor: pointer; transition: 0.2s; }
            .btn:hover { background: #d97706; }
            .retry-btn { margin-top: 10px; background: #1e293b; color: #cbd5e1; }
            .retry-btn:hover { background: #334155; }
        </style>
    </head>
    <body>
        <div class="card">
            <div style="font-size: 44px; margin-bottom: 12px;">📡</div>
            <h2>Serverga Ulanib Bo‘lmadi</h2>
            <p>Iltimos, asosiy server (kompyuter) yoqilganligini va tarmoqqa ulanganligini tekshiring.</p>
            <label style="display:block; text-align:left; font-size:11px; font-weight:bold; color:#cbd5e1; margin-top:14px;">Server Manzili (IP):</label>
            <input type="text" id="serverUrl" value="${config.serverUrl}" placeholder="http://192.168.1.100:3000">
            <button class="btn" onclick="saveAndRetry()">Saqlash va Ulanish</button>
            <button class="btn retry-btn" onclick="location.reload()">Qayta Urinish</button>
        </div>
        <script>
            function saveAndRetry() {
                const url = document.getElementById('serverUrl').value.trim();
                if (!url) return;
                window.desktopApp.saveServerUrl(url).then(() => {
                    location.reload();
                });
            }
        </script>
    </body>
    </html>
    `;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
}

// IPC Handlers
ipcMain.handle('get-app-role', () => role);
ipcMain.handle('get-server-config', () => loadConfig());
ipcMain.handle('save-server-url', (_e, newUrl) => {
    const config = loadConfig();
    config.serverUrl = newUrl;
    saveConfig(config);
    return true;
});
ipcMain.handle('toggle-fullscreen', () => {
    if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

