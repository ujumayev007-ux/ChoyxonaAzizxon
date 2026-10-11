import { Telegraf } from 'telegraf';
import { createHash } from 'crypto';
import { telegramToken } from './telegram';
import { prisma } from './db';
import { getSettings } from './settings';
let bot: Telegraf | undefined, fingerprint = '';
export async function refreshTelegramBot() {
    try {
        const token = await telegramToken(), next = token ? createHash('sha256').update(token).digest('hex') : '';
        if (next === fingerprint) return;
        try { bot?.stop('settings changed'); } catch { /* A stopped poller has no active loop. */ }
        bot = undefined; fingerprint = next;
        if (!token || process.env.TELEGRAM_MODE === 'webhook') return;
        const instance = new Telegraf(token); bot = instance;
        instance.start(async ctx => {
            const url = new URL(process.env.CUSTOMER_WEB_APP_URL || 'https://choyxonaazizxon.onrender.com/customer/');
            if (ctx.startPayload?.startsWith('table_')) url.searchParams.set('table', ctx.startPayload.slice(6));
            const info = await getSettings(prisma, 'restaurant');
            await ctx.reply(`Assalomu alaykum! ${info.restaurantName} restoraniga xush kelibsiz. Menyuni ochib buyurtma bering.`, { reply_markup: { inline_keyboard: [[{ text: 'Menyuni ochish', web_app: { url: url.toString() } }]] } });
        });
        instance.catch(() => console.error('Telegram bot so‘rovi bajarilmadi'));
        void instance.launch().catch(() => { if (bot === instance) fingerprint = ''; console.error('Telegram bot ulanmagan. Token va botning boshqa nusxalarini tekshiring'); });
    } catch { console.error('Telegram bot sozlamalarini yuklab bo‘lmadi'); }
}
export function startTelegramBot() {
    void refreshTelegramBot();
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { try { bot?.stop(signal); } catch {} });
}
