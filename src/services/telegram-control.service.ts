import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../utils/db';
import { approveDevice, rejectDevice, blockDevice } from './device.service';
import { approveTenant, rejectTenant, setTenantLock } from './tenant.service';

let botInstance: Telegraf | null = null;

export async function getTelegramConfig() {
    let config = await prisma.telegramBotConfig.findUnique({ where: { id: 'default' } });
    if (!config) {
        config = await prisma.telegramBotConfig.create({
            data: {
                id: 'default',
                botToken: process.env.TELEGRAM_OWNER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || null,
                ownerChatIds: process.env.TELEGRAM_OWNER_CHAT_ID ? [process.env.TELEGRAM_OWNER_CHAT_ID] : [],
                notifyOnDevice: true,
                notifyOnRegistration: true,
                notifyOnUnpaid: true,
                notifyOnExpiry: true,
                secureApproveEnabled: true
            }
        });
    }
    return config;
}

export async function updateTelegramConfig(data: {
    botToken?: string;
    botUsername?: string;
    ownerChatIds?: string[];
    notifyOnDevice?: boolean;
    notifyOnRegistration?: boolean;
    notifyOnUnpaid?: boolean;
    notifyOnExpiry?: boolean;
    secureApproveEnabled?: boolean;
}) {
    const updated = await prisma.telegramBotConfig.upsert({
        where: { id: 'default' },
        create: {
            id: 'default',
            ...data
        },
        update: {
            ...data
        }
    });

    // Reinitialize bot if token changed
    if (data.botToken !== undefined) {
        await initSuperOwnerTelegramBot();
    }

    return updated;
}

export async function initSuperOwnerTelegramBot() {
    const config = await getTelegramConfig();
    if (!config.botToken) {
        console.log('[TelegramControl] Bot token belgilanmagan. Telegram xabarnomasi kutilmoqda.');
        return;
    }

    try {
        if (botInstance) {
            try { botInstance.stop('RESTART'); } catch {}
            botInstance = null;
        }

        botInstance = new Telegraf(config.botToken);

        // Command: /start
        botInstance.command('start', async (ctx) => {
            const chatId = String(ctx.chat.id);
            const isOwner = config.ownerChatIds.includes(chatId);
            if (!isOwner) {
                return ctx.reply(`Sizning Chat ID: ${chatId}\n\nSuper Owner panelida ushbu Chat ID ni qo‘shing.`);
            }
            ctx.reply(
                `👑 <b>Super Owner Boshqaruv Botiga xush kelibsiz!</b>\n\n` +
                `Bu bot orqali yangi qurilmalarni tasdiqlash, yangi restoranlarni faollashtirish va tizim holatini kuzatishingiz mumkin.\n\n` +
                `Buyruqlar:\n` +
                `/status - Barcha restoranlar holati\n` +
                `/devices - Kutilayotgan qurilmalar\n` +
                `/help - Yordam`,
                { parse_mode: 'HTML' }
            );
        });

        // Command: /status
        botInstance.command('status', async (ctx) => {
            const chatId = String(ctx.chat.id);
            if (!config.ownerChatIds.includes(chatId)) return;

            const tenants = await prisma.tenant.findMany({ select: { name: true, status: true, currentPeriodEnd: true, isLocked: true } });
            let text = `📊 <b>Restoranlar holati (${tenants.length} ta):</b>\n\n`;
            tenants.forEach(t => {
                const daysLeft = Math.ceil((new Date(t.currentPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const icon = t.isLocked ? '⛔ QULFLANGAN' : t.status === 'ACTIVE' ? '🟢 FAOL' : '🟡 KUTILMOQDA';
                text += `• <b>${t.name}</b>: ${icon} (${daysLeft} kun qoldi)\n`;
            });
            ctx.reply(text, { parse_mode: 'HTML' });
        });

        // Command: /devices
        botInstance.command('devices', async (ctx) => {
            const chatId = String(ctx.chat.id);
            if (!config.ownerChatIds.includes(chatId)) return;

            const pending = await prisma.deviceAuthorization.findMany({
                where: { status: 'PENDING' },
                include: { tenant: { select: { name: true } } },
                take: 10
            });

            if (!pending.length) {
                return ctx.reply('✅ Hozirda kutilayotgan qurilma so‘rovlari yo‘q.');
            }

            for (const d of pending) {
                await sendDeviceApprovalRequest(d.id);
            }
        });

        // Action Handlers for Inline Buttons
        botInstance.action(/^dev:(app|rej|blk):(.+)$/, async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!config.ownerChatIds.includes(chatId)) {
                return ctx.answerCbQuery('Ruxsat berilmagan!', { show_alert: true });
            }

            const action = ctx.match[1];
            const deviceRowId = ctx.match[2];

            try {
                if (action === 'app') {
                    await approveDevice(deviceRowId, `TG_${chatId}`);
                    await ctx.editMessageText(`✅ <b>Qurilma muvaffaqiyatli TASDIQLANDI!</b>\nQurilma avtomatik faollashdi.`, { parse_mode: 'HTML' });
                } else if (action === 'rej') {
                    await rejectDevice(deviceRowId, 'Telegram orqali rad etildi', `TG_${chatId}`);
                    await ctx.editMessageText(`❌ <b>Qurilma RAD ETILDI!</b>`, { parse_mode: 'HTML' });
                } else if (action === 'blk') {
                    await blockDevice(deviceRowId, 'Telegram orqali bloklandi', `TG_${chatId}`);
                    await ctx.editMessageText(`⛔ <b>Qurilma BLOKLANDI!</b>`, { parse_mode: 'HTML' });
                }
                ctx.answerCbQuery('Amal bajarildi');
            } catch (err: any) {
                ctx.answerCbQuery(`Xatolik: ${err?.message || 'Bajarilmadi'}`, { show_alert: true });
            }
        });

        // Action Handlers for Restaurant Approval
        botInstance.action(/^ten:(app|rej|lck):(.+)$/, async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!config.ownerChatIds.includes(chatId)) {
                return ctx.answerCbQuery('Ruxsat berilmagan!', { show_alert: true });
            }

            const action = ctx.match[1];
            const tenantId = ctx.match[2];

            try {
                if (action === 'app') {
                    await approveTenant(tenantId, `TG_${chatId}`, 30);
                    await ctx.editMessageText(`✅ <b>Restoran ro‘yxatdan o‘tkazildi va 30 kunga faollashtirildi!</b>`, { parse_mode: 'HTML' });
                } else if (action === 'rej') {
                    await rejectTenant(tenantId, 'Telegram orqali rad etildi', `TG_${chatId}`);
                    await ctx.editMessageText(`❌ <b>Restoran arizasi RAD ETILDI.</b>`, { parse_mode: 'HTML' });
                } else if (action === 'lck') {
                    await setTenantLock(tenantId, true, 'Telegram orqali masofadan qulflandi', `TG_${chatId}`);
                    await ctx.editMessageText(`⛔ <b>Restoran tizimi QULFLANDI.</b>`, { parse_mode: 'HTML' });
                }
                ctx.answerCbQuery('Amal bajarildi');
            } catch (err: any) {
                ctx.answerCbQuery(`Xatolik: ${err?.message || 'Bajarilmadi'}`, { show_alert: true });
            }
        });

        botInstance.launch().catch(e => {
            console.warn('[TelegramControl] Bot launch warning:', e?.message);
        });

        console.log('✅ Super Owner Telegram Boti faol ishga tushirildi.');
    } catch (e: any) {
        console.error('[TelegramControl] Bot init xatosi:', e?.message);
    }
}

// ----------------------------------------------------------------------
// Notification dispatchers to Super Owner Telegram
// ----------------------------------------------------------------------

export async function sendTelegramNotification(text: string, keyboard?: any) {
    if (!botInstance) return;
    const config = await getTelegramConfig();
    for (const chatId of config.ownerChatIds) {
        try {
            await botInstance.telegram.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (e: any) {
            console.warn(`[TelegramControl] Xabar yuborishda xatolik (chatId: ${chatId}):`, e?.message);
        }
    }
}

export async function sendDeviceApprovalRequest(deviceRowId: string) {
    const device = await prisma.deviceAuthorization.findUnique({
        where: { id: deviceRowId },
        include: { tenant: true }
    });
    if (!device) return;

    const text =
        `📱 <b>YANGI QURILMA ULANISH SO‘ROVI!</b>\n\n` +
        `🏢 <b>Restoran:</b> ${device.tenant.name}\n` +
        `💻 <b>Qurilma:</b> ${device.deviceName} (${device.deviceType})\n` +
        `👤 <b>Rol:</b> ${device.role}\n` +
        `🌐 <b>IP manzil:</b> ${device.ipAddress || 'Aniqlanmadi'}\n` +
        `📅 <b>So‘rov vaqti:</b> ${new Date(device.requestedAt).toLocaleString('uz-UZ')}\n\n` +
        `Ushbu qurilmaga tizimga kirish uchun ruxsat berasizmi?`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Ruxsat berish', `dev:app:${device.id}`),
            Markup.button.callback('❌ Rad etish', `dev:rej:${device.id}`)
        ],
        [
            Markup.button.callback('⛔ Bloklash', `dev:blk:${device.id}`)
        ]
    ]).reply_markup;

    await sendTelegramNotification(text, keyboard);
}

export async function sendRegistrationNotification(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return;

    const text =
        `🏢 <b>YANGI RESTORAN RO‘YXATDAN O‘TDI!</b>\n\n` +
        `🍽 <b>Nomi:</b> ${tenant.name}\n` +
        `👤 <b>Rahbar:</b> ${tenant.ownerName}\n` +
        `📞 <b>Telefon:</b> ${tenant.ownerPhone}\n` +
        `📍 <b>Manzil:</b> ${tenant.address || '—'}\n` +
        `💰 <b>Rejalashtirilgan oylik:</b> ${Number(tenant.monthlyFee).toLocaleString('uz-UZ')} UZS\n` +
        `📅 <b>Sana:</b> ${new Date(tenant.createdAt).toLocaleString('uz-UZ')}\n\n` +
        `Restoranni faollashtirishni xohlaysizmi?`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Faollashtirish (30 kun)', `ten:app:${tenant.id}`),
            Markup.button.callback('❌ Rad etish', `ten:rej:${tenant.id}`)
        ]
    ]).reply_markup;

    await sendTelegramNotification(text, keyboard);
}

export async function sendUnpaidSubscriptionAlert(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return;

    const text =
        `⚠️ <b>TO‘LOV MUDDATI TUGADI!</b>\n\n` +
        `🏢 <b>Restoran:</b> ${tenant.name}\n` +
        `👤 <b>Mijoz:</b> ${tenant.ownerName} (${tenant.ownerPhone})\n` +
        `💰 <b>Oylik to‘lov:</b> ${Number(tenant.monthlyFee).toLocaleString('uz-UZ')} UZS\n` +
        `📅 <b>Muddati:</b> ${new Date(tenant.currentPeriodEnd).toLocaleDateString('uz-UZ')}\n\n` +
        `Agar to‘lov kelib tushmagan bo‘lsa, tizimni masofadan qulflashingiz mumkin:`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('⛔ Tizimni Qulflash', `ten:lck:${tenant.id}`),
            Markup.button.callback('⏱️ +30 kun uzaytirish', `ten:app:${tenant.id}`)
        ]
    ]).reply_markup;

    await sendTelegramNotification(text, keyboard);
}

