import type { Keyboard, TextEntity } from './types.ts';
import { displayDate } from '../utils/dates.ts';

// Text is never parsed as markup. Explicit entities style only the selected title.
// Keep surrogate pairs intact; Telegram entity offsets use UTF-16 units like string.length.
export function chunks(text: string, size = 3800): string[] {
  const result: string[] = [];
  while (text.length) {
    let end = Math.min(size, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  return result;
}
export const keyboard = (...rows: [string, string][][]): Keyboard => ({
  inline_keyboard: rows.map(row => row.map(([text, callback_data]) => ({ text, callback_data })))
});
export function channelLink(channel: string, message: number): string {
  if (!/^-100\d+$/.test(channel) || !Number.isSafeInteger(message) || message < 1) throw new Error('invalid_channel_link');
  return `https://t.me/c/${channel.slice(4)}/${message}`;
}

export function journalHeading(date: string, title: string): { text: string; entities: TextEntity[] } {
  const prefix = `📖 ${displayDate(date)}\n\n`;
  return { text: prefix + title, entities: [{ type: 'bold', offset: prefix.length, length: title.length }] };
}
