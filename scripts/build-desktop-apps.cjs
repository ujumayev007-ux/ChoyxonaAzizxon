// Har bir rol uchun alohida Windows o'rnatuvchisi (NSIS) yaratadi: electron-builder, windows-latest.
// Natija: dist-installers/release/<Nom>-Setup.exe
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const roles = require('../desktop/roles');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const out = path.join(root, 'dist-installers');
const release = path.join(out, 'release');
const names = { admin: 'Admin', cashier: 'Kassa', waiter: 'Ofitsiant', kitchen: 'Oshxona', owner: 'Owner', tv: 'TV' };
const only = process.argv.slice(2);
fs.mkdirSync(release, { recursive: true });

function makeIco(png, ico) {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${py} -c "from PIL import Image; im=Image.open(r'${png}').convert('RGBA').resize((256,256)); im.save(r'${ico}', sizes=[(256,256),(64,64),(48,48),(32,32),(16,16)])"`, { stdio: 'inherit' });
}

for (const id of Object.keys(roles)) {
    if (only.length && !only.includes(id)) continue;
    const name = names[id];
    const product = `Azizxon ${name}`;
    const dir = path.join(out, id);
    console.log(`\n=== ${name} ===`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(path.join(desktop, 'role.json'), JSON.stringify({ role: id }));
    fs.copyFileSync(path.join(desktop, 'icons', `${id}.png`), path.join(desktop, 'icon.png'));
    makeIco(path.join(desktop, 'icons', `${id}.png`), path.join(desktop, 'icon.ico'));
    const cfg = {
        appId: `com.azizxon.${id}`,
        productName: product,
        executableName: name,
        directories: { output: dir },
        files: ['main.js', 'preload.js', 'discovery.js', 'roles.js', 'role.json', 'icon.png', 'package.json'],
        extraResources: [{ from: 'icon.ico', to: 'icon.ico' }],
        win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'icon.ico', signAndEditExecutable: true },
        nsis: {
            oneClick: false,
            perMachine: false,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            shortcutName: product,
            installerIcon: 'icon.ico',
            uninstallerIcon: 'icon.ico',
            language: '1033',
            artifactName: `${name}-Setup.exe`
        }
    };
    const cfgPath = path.join(desktop, 'builder.tmp.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    try {
        // Imzolash kalitlari faqat muhit o'zgaruvchilari (CSC_LINK/CSC_KEY_PASSWORD) orqali beriladi
        execSync('npx electron-builder --win nsis --x64 --config builder.tmp.json --publish never', { cwd: desktop, stdio: 'inherit' });
    } finally { fs.rmSync(cfgPath, { force: true }); }

    const setup = path.join(dir, `${name}-Setup.exe`);
    if (!fs.existsSync(setup) || fs.statSync(setup).size < 40 * 1024 * 1024) throw new Error(`${name}: o'rnatuvchi topilmadi yoki juda kichik`);
    fs.copyFileSync(setup, path.join(release, `${name}-Setup.exe`));
    console.log(`OK ${name}-Setup.exe (${(fs.statSync(setup).size / 1048576).toFixed(1)} MB)`);
}
fs.rmSync(path.join(desktop, 'role.json'), { force: true });
