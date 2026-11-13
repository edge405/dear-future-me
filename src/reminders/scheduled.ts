import type { Env } from '../config/env.ts';
import { Store } from '../database/queries.ts';
import { Telegram } from '../telegram/api.ts';
import { keyboard } from '../telegram/formatting.ts';
import { manilaDate } from '../utils/dates.ts';
import { TelegramError, UserError } from '../utils/errors.ts';

export async function deliverReminder(env: Env, store: Store, tg: Telegram, scheduledTime: number, manual = false): Promise<void> {
  const date = manilaDate(scheduledTime);
  if (await store.first(`SELECT a.id FROM journal_archives a JOIN journal_drafts d ON d.id=a.draft_id
    WHERE a.journal_date=? AND a.status='published' AND d.telegram_user_id=?`, date, store.owner)) {
    if (manual) await tg.send(store.owner, 'Today is already saved. No reminder is needed.');
    return;
  }
  const now = Date.now();
  await store.run("UPDATE reminder_deliveries SET status='uncertain' WHERE owner_id=? AND reminder_date=? AND status='sending' AND attempted_at<?", store.owner, date, now - 180000);
  const existing = await store.first<{ status: string }>('SELECT status FROM reminder_deliveries WHERE owner_id=? AND reminder_date=?', store.owner, date);
  if (existing?.status === 'delivered' || existing?.status === 'sending' || (existing?.status === 'uncertain' && !manual)) {
    if (manual) await tg.send(store.owner, 'Today’s reminder was already sent or may still be in flight. I will not duplicate it.');
    return;
  }
  const claim = await store.run(`INSERT INTO reminder_deliveries(owner_id,reminder_date,status,attempted_at) VALUES (?,?,'sending',?)
    ON CONFLICT(owner_id,reminder_date) DO UPDATE SET status='sending',attempted_at=excluded.attempted_at,error_code=NULL
    WHERE reminder_deliveries.status='failed' OR (?=1 AND reminder_deliveries.status='uncertain')`, store.owner, date, now, manual ? 1 : 0);
  if (!claim) return;
  let id: number;
  try {
    [id] = await tg.send(env.OWNER_TELEGRAM_ID, '📖 Time to document your life!\n\nHow was your day?\nWhat happened? How did you feel?\nWhat was on your mind? What did you learn today?\n\nTake 5–10 minutes to capture today’s story, or just write a few words.\n\nTap Start Journal whenever you’re ready.', keyboard([['📖 Start Journal', 'j']]));
  } catch (error) {
    const ambiguous = !(error instanceof TelegramError) || error.ambiguous;
    await store.run('UPDATE reminder_deliveries SET status=?,error_code=? WHERE owner_id=? AND reminder_date=?', ambiguous ? 'uncertain' : 'failed',
      error instanceof TelegramError ? 'telegram_' + error.code : 'delivery_error', store.owner, date);
    if (manual) throw new UserError('The reminder could not be confirmed. Check your chat before using /reminder again.');
    return;
  }
  await store.run("UPDATE reminder_deliveries SET status='delivered',delivered_at=?,destination_message_id=? WHERE owner_id=? AND reminder_date=?", Date.now(), id, store.owner, date);
}

export async function scheduled(env: Env, controller: { cron: string; scheduledTime: number }): Promise<void> {
  if (controller.cron !== '0 11 * * *' || new Date(controller.scheduledTime).getUTCHours() !== 11 ||
      new Date(controller.scheduledTime).getUTCMinutes() !== 0 || Date.now() - controller.scheduledTime > 3600000) return;
  const store = new Store(env.DB, env.OWNER_TELEGRAM_ID);
  await store.locked(async () => {
    await deliverReminder(env, store, new Telegram(env.TELEGRAM_BOT_TOKEN), controller.scheduledTime);
    // Retain dedupe IDs beyond Telegram's usual update lifetime; bound cleanup work per run.
    await store.run('DELETE FROM processed_updates WHERE update_id IN (SELECT update_id FROM processed_updates WHERE processed_at<? LIMIT 1000)', Date.now() - 14 * 86400000);
    await store.run('DELETE FROM ai_usage WHERE usage_date<?', manilaDate(Date.now() - 30 * 86400000));
  });
}
