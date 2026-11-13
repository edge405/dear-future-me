import type { TgMessage, TgUpdate } from '../telegram/types.ts';

export function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v);
function message(v: unknown): v is TgMessage {
  if (!object(v) || !integer(v.message_id) || v.message_id < 1 || !integer(v.date) ||
      !object(v.chat) || !integer(v.chat.id) || typeof v.chat.type !== 'string') return false;
  if (v.from !== undefined && (!object(v.from) || !integer(v.from.id))) return false;
  for (const key of ['text', 'caption', 'media_group_id']) {
    if (v[key] !== undefined && typeof v[key] !== 'string') return false;
  }
  return (v.text === undefined || (v.text as string).length <= 16384) &&
    (v.caption === undefined || (v.caption as string).length <= 8192);
}
export function parseUpdate(v: unknown): TgUpdate | null {
  if (!object(v) || !integer(v.update_id) || v.update_id < 0) return null;
  if (v.message !== undefined && !message(v.message)) return null;
  if (v.edited_message !== undefined && !message(v.edited_message)) return null;
  if (v.channel_post !== undefined && !message(v.channel_post)) return null;
  if (v.callback_query !== undefined) {
    const c = v.callback_query;
    if (!object(c) || typeof c.id !== 'string' || !object(c.from) || !integer(c.from.id) ||
      (c.message !== undefined && !message(c.message)) ||
      (c.data !== undefined && (typeof c.data !== 'string' || new TextEncoder().encode(c.data).length > 64))) return null;
  }
  return v as unknown as TgUpdate;
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 256 * 1024) { await reader.cancel(); throw new Error('body_too_large'); }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}
