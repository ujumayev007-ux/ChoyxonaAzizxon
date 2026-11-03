// Har bir rol uchun alohida Windows o'rnatuvchisi yaratadi:
// electron-builder (--dir) ilovani paketlaydi, makensis esa o'rnatuvchi .exe ni yig'adi (wine kerak emas).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const roles = require('../desktop/roles');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const out = path.join(root, 'dist-installers');
const names = { admin: 'Admin', cashier: 'Kassa', waiter: 'Ofitsiant', kitchen: 'Oshxona', owner: 'Owner', tv: 'TV' };
const only = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

for (const id of Object.keys(roles)) {
    if (only.length && !only.includes(id)) continue;
    const name = names[id];
    const product = `Azizxon ${name}`;
    const unpackedDir = path.join(out, id);
    console.log(`\n=== ${name} ===`);
    fs.rmSync(unpackedDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(desktop, 'role.json'), JSON.stringify({ role: id }));
    fs.copyFileSync(path.join(desktop, 'icons', `${id}.png`), path.join(desktop, 'icon.png'));
    const cfg = {
        appId: `com.azizxon.${id}`,
        productName: product,
        directories: { output: unpackedDir },
        files: ['main.js', 'preload.js', 'discovery.js', 'roles.js', 'role.json', 'icon.png', 'package.json'],
        win: { target: 'dir', icon: 'icon.png', signAndEditExecutable: false }
    };
    const cfgPath = path.join(desktop, 'builder.tmp.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    try {
        execSync('npx electron-builder --win --x64 --dir --config builder.tmp.json --publish never', { cwd: desktop, stdio: 'inherit' });
    } finally { fs.rmSync(cfgPath, { force: true }); }

    const appDir = path.join(unpackedDir, 'win-unpacked');
    const exeName = fs.readdirSync(appDir).find(f => f.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(f));
    if (!exeName) throw new Error(`${name}: ilova .exe topilmadi`);

    const ico = path.join(unpackedDir, 'icon.ico');
    execSync(`python3 -c "from PIL import Image; Image.open(r'${path.join(desktop, 'icons', id + '.png')}').save(r'${ico}', sizes=[(256,256),(64,64),(48,48),(32,32),(16,16)])"`);
    fs.copyFileSync(ico, path.join(appDir, 'icon.ico'));

    const setup = path.join(out, `${name}-Setup.exe`);
    const nsi = path.join(unpackedDir, 'installer.nsi');
    fs.writeFileSync(nsi, `Unicode true
!include "MUI2.nsh"
Name "${product}"
OutFile "${setup}"
InstallDir "$LOCALAPPDATA\\Programs\\${product}"
RequestExecutionLevel user
SetCompressor zlib
Icon "${ico}"
UninstallIcon "${ico}"
!define MUI_ICON "${ico}"
!define MUI_UNICON "${ico}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${exeName}"
!define MUI_FINISHPAGE_RUN_TEXT "${product} ni hozir ishga tushirish"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Uzbek"
Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${appDir}\\*.*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortcut "$DESKTOP\\${product}.lnk" "$INSTDIR\\${exeName}" "" "$INSTDIR\\icon.ico"
  CreateDirectory "$SMPROGRAMS\\${product}"
  CreateShortcut "$SMPROGRAMS\\${product}\\${product}.lnk" "$INSTDIR\\${exeName}" "" "$INSTDIR\\icon.ico"
  CreateShortcut "$SMPROGRAMS\\${product}\\O'chirish.lnk" "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}" "DisplayName" "${product}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}" "DisplayIcon" "$INSTDIR\\icon.ico"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\\${product}.lnk"
  RMDir /r "$SMPROGRAMS\\${product}"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}"
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${product}"
  RMDir /r "$INSTDIR"
SectionEnd
`.replace(/\\/g, '\\'));
    execSync(`makensis -V2 "${nsi}"`, { stdio: 'inherit' });
    if (!fs.existsSync(setup) || fs.statSync(setup).size < 20 * 1024 * 1024) throw new Error(`${name}: o'rnatuvchi noto'g'ri`);
    console.log(`OK ${setup} (${(fs.statSync(setup).size / 1048576).toFixed(1)} MB)`);
}
