/**
 * Automated Windows EXE and Installer Builder for ChoyxonaAzizxon
 * Uses built-in Microsoft .NET Framework csc.exe compiler
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'desktop-windows');
const outputDir = path.join(rootDir, 'release-builds', 'windows');
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const iconPath = path.join(rootDir, 'public', 'favicon.ico');
const launcherCs = path.join(desktopDir, 'Launcher.cs');
const installerCs = path.join(desktopDir, 'Installer.cs');

async function buildWindows() {
    console.log('====================================================');
    console.log('💻 CHOYXONA AZIZXON — WINDOWS EXE & INSTALLER BUILDER');
    console.log('====================================================\n');

    fs.mkdirSync(outputDir, { recursive: true });

    // References needed for WinForms and Process/Network management
    const refs = '/r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:Microsoft.CSharp.dll';

    // 1. Build Azizxon_Admin.exe
    console.log('[1/5] 🛠️ Azizxon_Admin.exe kompilyatsiya qilinmoqda...');
    const adminExe = path.join(outputDir, 'Azizxon_Admin.exe');
    execSync(`"${csc}" /nologo /target:winexe /optimize /d:ROLE_ADMIN /win32icon:"${iconPath}" ${refs} /out:"${adminExe}" "${launcherCs}"`, { stdio: 'inherit' });

    // 2. Build Azizxon_Kassa.exe
    console.log('\n[2/5] 🛠️ Azizxon_Kassa.exe kompilyatsiya qilinmoqda...');
    const kassaExe = path.join(outputDir, 'Azizxon_Kassa.exe');
    execSync(`"${csc}" /nologo /target:winexe /optimize /d:ROLE_CASHIER /win32icon:"${iconPath}" ${refs} /out:"${kassaExe}" "${launcherCs}"`, { stdio: 'inherit' });

    // 3. Build Azizxon_Ofitsiant.exe
    console.log('\n[3/5] 🛠️ Azizxon_Ofitsiant.exe kompilyatsiya qilinmoqda...');
    const ofitsiantExe = path.join(outputDir, 'Azizxon_Ofitsiant.exe');
    execSync(`"${csc}" /nologo /target:winexe /optimize /d:ROLE_WAITER /win32icon:"${iconPath}" ${refs} /out:"${ofitsiantExe}" "${launcherCs}"`, { stdio: 'inherit' });

    // 4. Build Azizxon_SuperOwner.exe
    console.log('\n[4/5] 🛠️ Azizxon_SuperOwner.exe kompilyatsiya qilinmoqda...');
    const ownerExe = path.join(outputDir, 'Azizxon_SuperOwner.exe');
    execSync(`"${csc}" /nologo /target:winexe /optimize /d:ROLE_OWNER /win32icon:"${iconPath}" ${refs} /out:"${ownerExe}" "${launcherCs}"`, { stdio: 'inherit' });

    // Copy icon & default config to output directory
    fs.copyFileSync(iconPath, path.join(outputDir, 'favicon.ico'));
    const defaultConfig = {
        serverUrl: "http://localhost:3000",
        description: "Choyxona Azizxon Windows Desktop Client",
        version: "2.1.0"
    };
    fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(defaultConfig, null, 2));

    // 5. Build Azizxon_Setup.exe (Installer)
    console.log('\n[5/5] 📦 Azizxon_Universal_Setup.exe o‘rnatuvchisi yaratilmoqda...');
    const setupExe = path.join(outputDir, 'Azizxon_Universal_Setup.exe');
    execSync(`"${csc}" /nologo /target:winexe /optimize /win32icon:"${iconPath}" ${refs} /out:"${setupExe}" "${installerCs}"`, { stdio: 'inherit' });

    console.log('\n====================================================');
    console.log('🎉 BARCHA WINDOWS EXE VA O‘RNATUVCHILAR TAYYOR!');
    console.log(`📁 Papka: ${outputDir}`);
    console.log(`  🔹 Azizxon_Universal_Setup.exe (O‘rnatuvchi)`);
    console.log(`  🔹 Azizxon_Kassa.exe (Kassir ish stoli)`);
    console.log(`  🔹 Azizxon_Ofitsiant.exe (Ofitsiant ish stoli)`);
    console.log(`  🔹 Azizxon_Admin.exe (Admin boshqaruv)`);
    console.log(`  🔹 Azizxon_SuperOwner.exe (Super Owner HQ)`);
    console.log('====================================================\n');
}

buildWindows().catch(err => {
    console.error('❌ Windows build xatolik:', err);
    process.exit(1);
});

