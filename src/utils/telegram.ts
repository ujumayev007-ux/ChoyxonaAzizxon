import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { decryptSecret } from './secrets';

const telegramApiBase = 'https://api.telegram.org';

export async function telegramToken(): Promise<string | undefined> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'telegramSecret' } });
  return row ? decryptSecret(String(row.value)) : process.env.TELEGRAM_BOT_TOKEN;
}
export async function sendTelegramMessage(chatId: string, text: string, kind = 'XABAR'): Promise<boolean> {
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
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
  if (!data.ok) throw Error('TELEGRAM_DELIVERY_FAILED');
  await prisma.telegramDelivery.create({ data: { chatId, kind, status: 'YUBORILDI' } });
  return true;
  } catch {
    await prisma.telegramDelivery.create({ data: { chatId, kind, status: 'XATOLIK' } });
    throw Error('TELEGRAM_DELIVERY_FAILED');
  }
}

export function formatTelegramMessage(title: string, lines: string[]): string {
  const safeLines = lines.map(line => line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return `<b>${title}</b>\n\n${safeLines.join("\n")}`;
}

export async function sendToActiveSubscribers(text: string): Promise<{ success: number; failed: number }> {
  const subscribers = await prisma.telegramSubscriber.findMany({ where: { isActive: true, verifiedAt: { not: null } } });
  let success = 0;
  let failed = 0;
  for (const s of subscribers) {
    try {
      const ok = await sendTelegramMessage(s.chatId, text);
      if (ok) success++;
      else failed++;
    } catch (error) {
      failed++;
      console.error('Telegram xabari yuborilmadi');
    }
  }
  return { success, failed };
}
