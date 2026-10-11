// Restorandagi kompyuterda: PRINT_SERVER_URL va PRINT_AGENT_TOKEN ni sozlang.
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const server = (process.env.PRINT_SERVER_URL || '').replace(/\/$/, '');
const token = process.env.PRINT_AGENT_TOKEN;
const resultFile = path.join(__dirname, '.print-agent-result.json');
if (!/^https:\/\//.test(server) || !token) { console.error('PRINT_SERVER_URL (https) va PRINT_AGENT_TOKEN kerak'); process.exit(1); }
async function api(route, body = {}) {
    const response = await fetch(`${server}/api/print-agent${route}`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
    if (!response.ok) throw new Error(`Printer serveri: ${response.status}`);
    return response.json();
}
function receipt(job) {
    const p = job.payload, width = job.printer.paperWidth === 58 ? 32 : 42;
    return [p.restaurantName, p.department, `Buyurtma: ${p.orderNumber}`, p.table,
        `Ofitsant: ${p.waiter}`, `Mijozlar: ${p.guestCount || 1}`, p.createdAt,
        '-'.repeat(width), ...p.items.flatMap(i => [`${i.quantity}  ${i.name}`, ...(i.notes ? [i.notes] : [])]),
        '-'.repeat(width), p.notes || '', p.footer || '', '', '', ''].join('\n');
}
async function print(job) {
    const text = receipt(job);
    if (job.printer.connectionType === 'WINDOWS') {
        if (process.platform !== 'win32') throw new Error('Windows printeri uchun Windows kompyuter kerak');
        await new Promise((resolve, reject) => {
            const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $text = [Console]::In.ReadToEnd(); $text | Out-Printer -Name $env:RESTAURANT_PRINTER -ErrorAction Stop'],
            { windowsHide: true, env: { ...process.env, RESTAURANT_PRINTER: job.printer.ipAddress }, stdio: ['pipe', 'ignore', 'ignore'] });
            child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Windows printeriga yuborilmadi')));
            child.stdin.on('error', reject); child.stdin.end(text);
        });
    } else {
        // ESC/POS printerlar uchun mos lotincha matn; boshqaruv belgilarini tozalash.
        const ascii = text.replace(/[‘’ʻʼ]/g, "'").replace(/[^\x20-\x7e\n]/g, '?');
        const bytes = Buffer.concat([Buffer.from([27, 64]), Buffer.from(ascii, 'ascii'), Buffer.from([29, 86, 0])]);
        await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: job.printer.ipAddress, port: job.printer.port });
            socket.setTimeout(15000, () => socket.destroy(new Error('Printer javob bermadi')));
            socket.on('error', reject); socket.on('connect', () => socket.end(bytes));
            socket.on('close', hadError => { if (!hadError) resolve(); });
        });
    }
}
async function cycle() {
    // Natija serverga yetmaganda qayta chop etish o‘rniga faqat natijani takrorlaymiz.
    if (fs.existsSync(resultFile)) {
        const pending = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        await api(`/${pending.id}/result`, { status: pending.status });
        fs.unlinkSync(resultFile);
    }
    const { job } = await api('/claim');
    if (!job) return;
    let status = 'YUBORILDI';
    try { await print(job); } catch (error) { status = 'XATOLIK'; console.error(error.message); }
    fs.writeFileSync(resultFile, JSON.stringify({ id: job.id, status }), { mode: 0o600 });
    await api(`/${job.id}/result`, { status });
    fs.unlinkSync(resultFile);
    console.log(`Chek ${job.id}: ${status}`);
}
(async () => { for (;;) { try { await cycle(); } catch (error) { console.error(error.message); } await new Promise(resolve => setTimeout(resolve, 3000)); } })();
