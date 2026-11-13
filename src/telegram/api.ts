import { TelegramError, UserError } from '../utils/errors.ts';
import { chunks } from './formatting.ts';
import type { Keyboard, TextEntity } from './types.ts';

export class Telegram {
  token: string;
  constructor(token: string) { this.token = token; }
  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    // Fixed methods only; never expose raw response errors, request URLs, or tokens in logs.
    if (body.allow_paid_broadcast) throw new Error('paid_features_forbidden');
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
      });
      const data = await response.json() as { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number } };
      if (!response.ok || !data.ok) {
        const code = data.error_code ?? response.status;
        throw new TelegramError(code, code >= 500, data.parameters?.retry_after);
      }
      return data.result;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(0, true);
    }
  }
  async send(chat: string, text: string, reply_markup?: Keyboard, entities?: TextEntity[]): Promise<number[]> {
    const parts = chunks(text);
    const ids: number[] = [];
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const partEntities = entities?.flatMap(entity => {
        const start = Math.max(entity.offset, offset);
        const end = Math.min(entity.offset + entity.length, offset + parts[i].length);
        return end > start ? [{ ...entity, offset: start - offset, length: end - start }] : [];
      });
      const sent = await this.call<{ message_id: number }>('sendMessage', {
        chat_id: chat, text: parts[i], link_preview_options: { is_disabled: true },
        ...(partEntities?.length ? { entities: partEntities } : {}),
        ...(i === parts.length - 1 && reply_markup ? { reply_markup } : {})
      });
      ids.push(sent.message_id);
      offset += parts[i].length;
    }
    return ids;
  }
  async verifyChannel(channel: string, owner: string): Promise<void> {
    const me = await this.call<{ id: number }>('getMe');
    const chat = await this.call<{ id: number; type: string; username?: string; linked_chat_id?: number }>('getChat', { chat_id: channel });
    const member = await this.call<{ status: string; can_post_messages?: boolean }>('getChatMember', { chat_id: channel, user_id: me.id });
    const ownerMember = await this.call<{ status: string }>('getChatMember', { chat_id: channel, user_id: Number(owner) });
    const memberCount = await this.call<number>('getChatMemberCount', { chat_id: channel });
    if (String(chat.id) !== channel || chat.type !== 'channel' || chat.username || chat.linked_chat_id || memberCount > 2 ||
      member.status !== 'administrator' || !member.can_post_messages || ownerMember.status !== 'creator')
      throw new UserError('Check the private archive channel: you must own it, and the bot needs permission to post as an administrator.');
  }
}
