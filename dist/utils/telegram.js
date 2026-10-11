"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramToken = telegramToken;
exports.sendTelegramMessage = sendTelegramMessage;
exports.formatTelegramMessage = formatTelegramMessage;
exports.sendToActiveSubscribers = sendToActiveSubscribers;
const db_1 = require("./db");
const secrets_1 = require("./secrets");
const telegramApiBase = 'https://api.telegram.org';
async function telegramToken() {
    const row = await db_1.prisma.appSetting.findUnique({ where: { key: 'telegramSecret' } });
    return row ? (0, secrets_1.decryptSecret)(String(row.value)) : process.env.TELEGRAM_BOT_TOKEN;
}
async function sendTelegramMessage(chatId, text, kind = 'XABAR') {
    const token = await telegramToken();
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }
    try {
        const res = await fetch(`${telegramApiBase}/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000), body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        if (!res.ok) {
            throw new Error('TELEGRAM_DELIVERY_FAILED');
        }
        const data = (await res.json().catch(() => ({})));
        if (!data.ok)
            throw Error('TELEGRAM_DELIVERY_FAILED');
        await db_1.prisma.telegramDelivery.create({ data: { chatId, kind, status: 'YUBORILDI' } });
        return true;
    }
    catch {
        await db_1.prisma.telegramDelivery.create({ data: { chatId, kind, status: 'XATOLIK' } });
        throw Error('TELEGRAM_DELIVERY_FAILED');
    }
}
function formatTelegramMessage(title, lines) {
    const safeLines = lines.map(line => line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `<b>${title}</b>\n\n${safeLines.join("\n")}`;
}
async function sendToActiveSubscribers(text) {
    const subscribers = await db_1.prisma.telegramSubscriber.findMany({ where: { isActive: true, verifiedAt: { not: null } } });
    let success = 0;
    let failed = 0;
    for (const s of subscribers) {
        try {
            const ok = await sendTelegramMessage(s.chatId, text);
            if (ok)
                success++;
            else
                failed++;
        }
        catch (error) {
            failed++;
            console.error('Telegram xabari yuborilmadi');
        }
    }
    return { success, failed };
}
