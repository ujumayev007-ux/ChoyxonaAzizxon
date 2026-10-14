/**
 * Automated Android APK Builder for ChoyxonaAzizxon
 * Uses Android SDK 36.0.0 and Temurin JDK 21
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'mobile-android');
const buildDir = path.join(androidDir, 'build');
const outputDir = path.join(rootDir, 'release-builds', 'android');

const jdkBin = 'C:\\Users\\PRESTIGE\\AppData\\Local\\Temp\\claude\\c--Users-PRESTIGE-fastfood-app\\4906d8cb-bd17-46d5-8e08-e4153a4f8018\\scratchpad\\jdk\\jdk-21.0.12.1+1\\bin';
const androidSdk = 'C:\\Users\\PRESTIGE\\AppData\\Local\\Android\\Sdk';
const buildTools = path.join(androidSdk, 'build-tools', '36.0.0');
const androidJar = path.join(androidSdk, 'platforms', 'android-37.0', 'android.jar');

const aapt2 = path.join(buildTools, 'aapt2.exe');
const d8 = path.join(buildTools, 'd8.bat');
const zipalign = path.join(buildTools, 'zipalign.exe');
const apksigner = path.join(buildTools, 'apksigner.bat');

const javac = path.join(jdkBin, 'javac.exe');
const keytool = path.join(jdkBin, 'keytool.exe');
const jar = path.join(jdkBin, 'jar.exe');

async function buildApk() {
    console.log('====================================================');
    console.log('🤖 CHOYXONA AZIZXON — ANDROID APK BUILDER');
    console.log('====================================================\n');

    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const genDir = path.join(buildDir, 'gen');
    const objDir = path.join(buildDir, 'obj');
    const resCompiled = path.join(buildDir, 'res.zip');
    fs.mkdirSync(genDir, { recursive: true });
    fs.mkdirSync(objDir, { recursive: true });

    // 1. Compile Resources with aapt2
    console.log('[1/7] 📦 aapt2 orqali resurslarni kompilyatsiya qilish...');
    const resDir = path.join(androidDir, 'res');
    const resFlata = path.join(buildDir, 'res.flata');
    execSync(`"${aapt2}" compile --dir "${resDir}" -o "${resFlata}"`, { stdio: 'inherit' });

    // 2. Link Resources
    console.log('\n[2/7] 🔗 aapt2 link orqali R.java va base APK yaratish...');
    const manifestPath = path.join(androidDir, 'AndroidManifest.xml');
    const baseApk = path.join(buildDir, 'base.apk');
    execSync(`"${aapt2}" link -I "${androidJar}" --manifest "${manifestPath}" "${resFlata}" --java "${genDir}" -o "${baseApk}" --auto-add-overlay`, { stdio: 'inherit' });

    // 3. Compile Java sources with javac
    console.log('\n[3/7] ☕ Java kodlarini kompilyatsiya qilish (javac)...');
    const rJava = path.join(genDir, 'com', 'choyxona', 'azizxon', 'R.java');
    const mainJava = path.join(androidDir, 'src', 'com', 'choyxona', 'azizxon', 'MainActivity.java');
    
    execSync(`"${javac}" -cp "${androidJar}" -source 8 -target 8 -d "${objDir}" "${rJava}" "${mainJava}"`, { stdio: 'inherit' });

    // 4. Convert .class files to classes.dex using d8
    console.log('\n[4/7] ⚙️ d8 orqali classes.dex faylini generatsiya qilish...');
    const classFiles = [];
    function findClassFiles(dir) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);
            if (fs.statSync(full).isDirectory()) findClassFiles(full);
            else if (file.endsWith('.class')) classFiles.push(full);
        }
    }
    findClassFiles(objDir);

    const dexOutputDir = path.join(buildDir, 'dex');
    fs.mkdirSync(dexOutputDir, { recursive: true });
    
    execSync(`"${d8}" --lib "${androidJar}" --output "${dexOutputDir}" ${classFiles.map(f => `"${f}"`).join(' ')}`, {
        stdio: 'inherit',
        env: { ...process.env, PATH: `${jdkBin};${process.env.PATH}`, JAVA_HOME: path.dirname(jdkBin) }
    });

    // 5. Add classes.dex into APK
    console.log('\n[5/7] 📥 classes.dex faylini APK ga joylash...');
    const classesDex = path.join(dexOutputDir, 'classes.dex');
    process.chdir(dexOutputDir);
    execSync(`"${jar}" -uf "${baseApk}" classes.dex`, { stdio: 'inherit' });
    process.chdir(rootDir);

    // 6. Zipalign the APK
    console.log('\n[6/7] 📐 zipalign orqali APK ni tekislash (4-byte alignment)...');
    const alignedApk = path.join(buildDir, 'aligned.apk');
    if (fs.existsSync(alignedApk)) fs.unlinkSync(alignedApk);
    execSync(`"${zipalign}" -p -f 4 "${baseApk}" "${alignedApk}"`, { stdio: 'inherit' });

    // 7. Sign the APK with keystore
    console.log('\n[7/7] 🔑 apksigner orqali APK ni raqamli imzolash...');
    const keystorePath = path.join(androidDir, 'release.keystore');
    if (!fs.existsSync(keystorePath)) {
        console.log('   Yangi release.keystore yaratilmoqda...');
        execSync(`"${keytool}" -genkey -v -keystore "${keystorePath}" -alias choyxona -keyalg RSA -keysize 2048 -validity 10000 -storepass Azizxon2026! -keypass Azizxon2026! -dname "CN=ChoyxonaAzizxon, OU=IT, O=Azizxon, L=Tashkent, C=UZ"`, { stdio: 'inherit' });
    }

    const finalApk = path.join(outputDir, 'ChoyxonaAzizxon.apk');
    fs.copyFileSync(alignedApk, finalApk);

    execSync(`"${apksigner}" sign --ks "${keystorePath}" --ks-pass pass:Azizxon2026! --ks-key-alias choyxona --key-pass pass:Azizxon2026! "${finalApk}"`, {
        stdio: 'inherit',
        env: { ...process.env, PATH: `${jdkBin};${process.env.PATH}`, JAVA_HOME: path.dirname(jdkBin) }
    });

    console.log('   Imzoni tekshirish...');
    execSync(`"${apksigner}" verify "${finalApk}"`, {
        stdio: 'inherit',
        env: { ...process.env, PATH: `${jdkBin};${process.env.PATH}`, JAVA_HOME: path.dirname(jdkBin) }
    });

    // Create role-specific copies for convenient distribution
    const waiterApk = path.join(outputDir, 'ChoyxonaAzizxon_Ofitsiant.apk');
    const cashierApk = path.join(outputDir, 'ChoyxonaAzizxon_Kassa.apk');
    const adminApk = path.join(outputDir, 'ChoyxonaAzizxon_Admin.apk');
    fs.copyFileSync(finalApk, waiterApk);
    fs.copyFileSync(finalApk, cashierApk);
    fs.copyFileSync(finalApk, adminApk);

    const stats = fs.statSync(finalApk);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    console.log('\n====================================================');
    console.log(`🎉 ANDROID APK MUVAFFAQIYATLI YARATILDI!`);
    console.log(`📱 Fayl: ${finalApk} (${sizeMb} MB)`);
    console.log(`📱 Ofitsiant: ${waiterApk}`);
    console.log(`📱 Kassa: ${cashierApk}`);
    console.log(`📱 Admin: ${adminApk}`);
    console.log('====================================================\n');
}

buildApk().catch(err => {
    console.error('❌ APK yaratishda xatolik:', err);
    process.exit(1);
});

