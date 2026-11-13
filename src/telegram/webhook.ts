import type { Env } from '../config/env.ts';
import { isOwner } from '../security/authorization.ts';
import { parseUpdate, readBoundedJson, secretMatches } from '../security/webhook-validation.ts';
import { Bot } from './commands.ts';
import { callback } from './callbacks.ts';
import { BusyError, UserError } from '../utils/errors.ts';

export async function webhook(request: Request, env: Env): Promise<Response> {
  if (!secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Forbidden', { status: 403 });
  let raw: unknown;
  try { raw = await readBoundedJson(request); } catch { return new Response('Invalid body', { status: 400 }); }
  const update = parseUpdate(raw);
  if (!update) return new Response('Invalid update', { status: 400 });
  // Reject non-owner/group/channel operations before ANY database or journal access.
  // Setup channel_post/my_chat_member updates are intentionally acknowledged without storing content.
  if (!isOwner(update, env.OWNER_TELEGRAM_ID)) return new Response('OK');
  const bot = new Bot(env);
  try {
    await bot.store.locked(async () => {
      const token = await bot.store.claim(update.update_id);
      if (!token) return;
      try {
        try {
          if (update.callback_query) await callback(bot, update.callback_query);
          else if (update.edited_message) {
            if (await bot.drafts.edit(update.edited_message)) await bot.send('Updated your draft and cleared its old preview. Use /done when ready.');
          }
          else if (update.message) await bot.command(update.message, update.update_id);
        } catch (error) {
          if (error instanceof UserError) await bot.send(error.message);
          else throw error;
        }
        await bot.store.run("UPDATE processed_updates SET status='done',processed_at=? WHERE update_id=? AND token=?", Date.now(), update.update_id, token);
      } catch (error) {
        await bot.store.run("UPDATE processed_updates SET lease_until=0 WHERE update_id=? AND token=? AND status='processing'", update.update_id, token);
        throw error;
      }
    });
    return new Response('OK');
  } catch (error) {
    if (!(error instanceof BusyError)) console.warn(JSON.stringify({ event: 'webhook_retry', update_id: update.update_id }));
    return new Response('Temporarily unavailable. Retry later.', { status: 503, headers: { 'retry-after': '5' } });
  }
}
