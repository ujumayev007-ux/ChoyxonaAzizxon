"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshTelegramBot = refreshTelegramBot;
exports.startTelegramBot = startTelegramBot;
const telegraf_1 = require("telegraf");
const crypto_1 = require("crypto");
const telegram_1 = require("./telegram");
const db_1 = require("./db");
const settings_1 = require("./settings");
let bot, fingerprint = '';
async function refreshTelegramBot() {
    try {
        const token = await (0, telegram_1.telegramToken)(), next = token ? (0, crypto_1.createHash)('sha256').update(token).digest('hex') : '';
        if (next === fingerprint)
            return;
        try {
            bot?.stop('settings changed');
        }
        catch { /* A stopped poller has no active loop. */ }
        bot = undefined;
        fingerprint = next;
        if (!token || process.env.TELEGRAM_MODE === 'webhook')
            return;
        const instance = new telegraf_1.Telegraf(token);
        bot = instance;
        instance.start(async (ctx) => {
            const url = new URL(process.env.CUSTOMER_WEB_APP_URL || 'https://choyxonaazizxon.onrender.com/customer/');
            if (ctx.startPayload?.startsWith('table_'))
                url.searchParams.set('table', ctx.startPayload.slice(6));
            const info = await (0, settings_1.getSettings)(db_1.prisma, 'restaurant');
            await ctx.reply(`Assalomu alaykum! ${info.restaurantName} restoraniga xush kelibsiz. Menyuni ochib buyurtma bering.`, { reply_markup: { inline_keyboard: [[{ text: 'Menyuni ochish', web_app: { url: url.toString() } }]] } });
        });
        instance.catch(() => console.error('Telegram bot so‘rovi bajarilmadi'));
        void instance.launch().catch(() => { if (bot === instance)
            fingerprint = ''; console.error('Telegram bot ulanmagan. Token va botning boshqa nusxalarini tekshiring'); });
    }
    catch {
        console.error('Telegram bot sozlamalarini yuklab bo‘lmadi');
    }
}
function startTelegramBot() {
    void refreshTelegramBot();
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => { try {
            bot?.stop(signal);
        }
        catch { } });
}
