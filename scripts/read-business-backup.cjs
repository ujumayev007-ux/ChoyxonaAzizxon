const fs = require('node:fs');
const { decryptSecret } = require('../dist/utils/secrets');
const [input, output] = process.argv.slice(2);
try {
    if (!input || !output || fs.statSync(input).size > 60 * 1024 * 1024) throw Error();
    const envelope = JSON.parse(fs.readFileSync(input, 'utf8'));
    if (envelope.format !== 'choyxona-encrypted-v1') throw Error();
    const text = decryptSecret(envelope.encryptedData), snapshot = JSON.parse(text);
    if (snapshot.format !== 'choyxona-business-v1') throw Error();
    fs.writeFileSync(output, text, { flag: 'wx', mode: 0o600 });
    console.log('Nusxa ochildi. Natijani xavfsiz joyda saqlang.');
} catch { console.error('Nusxa ochilmadi. Kalit, fayl formati va yangi chiqish manzilini tekshiring. Mavjud fayl ustiga yozilmaydi.'); process.exitCode = 1; }
