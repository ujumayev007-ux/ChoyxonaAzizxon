import { Prisma } from '@prisma/client';
import { prisma } from './db';

const telegramApiBase = 'https://api.telegram.org';

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  const res = await fetch(`${telegramApiBase}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API error: ${res.status} ${body}`);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return Boolean(data.ok);
}

export function formatTelegramMessage(title: string, lines: string[]): string {
  const safeLines = lines.map(line => line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return `<b>${title}</b>\n\n${safeLines.join("\n")}`;
}

export async function sendToActiveSubscribers(text: string): Promise<{ success: number; failed: number }> {
  const subscribers = await prisma.telegramSubscriber.findMany({ where: { isActive: true } });
  let success = 0;
  let failed = 0;
  for (const s of subscribers) {
    try {
      const ok = await sendTelegramMessage(s.chatId, text);
      if (ok) success++;
      else failed++;
    } catch (error) {
      failed++;
      console.error('Failed to send Telegram message:', error);
    }
  }
  return { success, failed };
}
