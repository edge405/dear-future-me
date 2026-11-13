import type { TgCallback } from './types.ts';
import { Bot } from './commands.ts';
import { UserError } from '../utils/errors.ts';
import { aiConfigured } from '../ai/gemini.ts';

export async function callback(bot: Bot, c: TgCallback): Promise<void> {
  // Callback ownership has already been verified by the webhook.
  try { await bot.tg.call('answerCallbackQuery', { callback_query_id: c.id }); } catch { /* Expired UI acknowledgements do not change workflow state. */ }
  const data = c.data ?? '';
  if (data === 'j') { await bot.start(); return; }
  if (data === 'off') { await bot.disableAi(); return; }
  if (data.startsWith('a:')) {
    if (!aiConfigured(bot.env)) throw new UserError('AI setup is disabled or expired. Originals remain available.');
    const updated = await bot.store.run(`UPDATE app_settings SET ai_consent=1,consent_nonce=NULL,consent_expires_at=NULL,updated_at=?
      WHERE owner_id=? AND consent_nonce=? AND consent_expires_at>=?`, Date.now(), bot.store.owner, data.slice(2), Date.now());
    if (!updated) throw new UserError('That consent button expired. Use /ai_on to review the current notice.');
    await bot.send('Text AI is enabled for future preparations. Use /done when ready, and review the result before saving.');
    return;
  }
  const parsed = /^([dposgwvxc]):([a-f0-9-]{36}):(\d+)(?::(\d+))?$/.exec(data);
  if (!parsed) throw new UserError('That button is unavailable. Use /status or /journal.');
  const [, action, id, rev, page] = parsed;
  const draft = await bot.drafts.get(id);
  if (!draft || draft.revision !== Number(rev)) throw new UserError('This draft changed after that button was shown. Use /done or /preview for the latest version.');
  await bot.store.run('UPDATE app_settings SET selected_draft_id=? WHERE owner_id=?', draft.id, bot.store.owner);
  switch (action) {
    case 'd': await bot.prepare(draft); break;
    case 'p': await bot.entries.preview(draft, Number(page ?? 0)); break;
    case 's': await bot.save(draft); break;
    case 'o': await bot.save(draft, true); break;
    case 'g': await bot.prepare(draft, true); break;
    case 'v': await bot.send('Send /revise followed by a short request, such as “make it shorter and keep the mixed language”. This uses text AI if enabled. To edit your original notes, edit them in this chat or choose Continue Writing.'); break;
    case 'w': await bot.drafts.continue(draft.id); await bot.send('Your draft is open. Keep writing, then send /done for a fresh preview.'); break;
    case 'x': await bot.confirmCancel(draft); break;
    case 'c': await bot.drafts.cancel(draft.id); await bot.send('Draft cancelled. You can start again whenever you like with /journal.'); break;
  }
}
