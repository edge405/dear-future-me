import type { TgUpdate } from '../telegram/types.ts';

export function isOwner(update: TgUpdate, owner: string): boolean {
  const c = update.callback_query;
  const m = c?.message ?? update.message ?? update.edited_message;
  const from = c?.from ?? m?.from;
  return !!m && !!from && !from.is_bot && String(from.id) === owner &&
    m.chat.type === 'private' && String(m.chat.id) === owner;
}
