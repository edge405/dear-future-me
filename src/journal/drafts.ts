import { Store } from '../database/queries.ts';
import type { Draft, DraftMessage } from '../database/types.ts';
import type { TgMessage } from '../telegram/types.ts';
import { messageType } from '../telegram/media.ts';
import { manilaDate, validEntryDate } from '../utils/dates.ts';
import { UserError } from '../utils/errors.ts';

const contentLength = (m: TgMessage): number => Array.from(m.text ?? '').length + Array.from(m.caption ?? '').length;

export class Drafts {
  store: Store;
  constructor(store: Store) { this.store = store; }
  get(id: string): Promise<Draft | null> {
    return this.store.first<Draft>('SELECT * FROM journal_drafts WHERE id = ? AND telegram_user_id = ?', id, this.store.owner);
  }
  async selected(): Promise<Draft> {
    const settings = await this.store.settings();
    const draft = settings.selected_draft_id ? await this.get(settings.selected_draft_id) : null;
    if (!draft) throw new UserError('Start with /journal, or use /date YYYY-MM-DD for a past day.');
    return draft;
  }
  messages(id: string): Promise<DraftMessage[]> {
    return this.store.all<DraftMessage>('SELECT * FROM journal_draft_messages WHERE draft_id = ? ORDER BY telegram_message_id', id);
  }
  async start(date = manilaDate()): Promise<Draft> {
    if (!validEntryDate(date)) throw new UserError('Use a real date in YYYY-MM-DD format, from 1900 through today in the Philippines.');
    const s = this.store;
    await s.settings();
    await s.run(`INSERT OR IGNORE INTO journal_drafts(id, telegram_user_id, entry_date, status, created_at, updated_at)
      VALUES (?, ?, ?, 'collecting', ?, ?)`, crypto.randomUUID(), s.owner, date, Date.now(), Date.now());
    const draft = (await s.first<Draft>("SELECT * FROM journal_drafts WHERE telegram_user_id = ? AND entry_date = ? AND status NOT IN ('published','cancelled')", s.owner, date))!;
    await s.run('UPDATE app_settings SET selected_draft_id = ?, updated_at = ? WHERE owner_id = ?', draft.id, Date.now(), s.owner);
    return draft;
  }
  async append(m: TgMessage, update: number): Promise<Draft> {
    const draft = await this.selected();
    if (!['collecting','preview_ready','failed','preparing'].includes(draft.status))
      throw new UserError('This entry is already being saved or is closed. Use /journal or /date to select another day before sending more memories.');
    const type = messageType(m);
    if (!type) throw new UserError('I cannot archive that message type or protected content. Please send ordinary text, photos, video, voice, audio, or a document.');
    const stats = (await this.store.first<{ count: number; length: number }>(`SELECT COUNT(*) AS count,
      COALESCE(SUM(COALESCE(length(original_text),0) + COALESCE(length(original_caption),0)),0) AS length
      FROM journal_draft_messages WHERE draft_id = ?`, draft.id))!;
    if (stats.count >= 500 || stats.length + contentLength(m) > 48000)
      throw new UserError('This draft has reached its safe size limit (500 messages or 48,000 text characters). Your existing draft is preserved.');
    const now = Date.now();
    // One transaction: content insertion and preview invalidation succeed or roll back together.
    await this.store.db.batch([
      this.store.stmt(`INSERT OR IGNORE INTO journal_draft_messages(draft_id,telegram_chat_id,telegram_message_id,
        telegram_update_id,media_group_id,message_type,original_text,original_caption,telegram_created_at,received_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, draft.id, String(m.chat.id), m.message_id, update,
        m.media_group_id ?? null, type, m.text ?? null, m.caption ?? null, m.date, now),
      this.store.stmt(`UPDATE journal_drafts SET status='collecting', revision=revision+1, preview_revision=NULL,
        title=NULL, ai_preview=NULL, ai_reflection=NULL, ai_question=NULL, preview_kind=NULL,
        last_content_at=?,updated_at=? WHERE id=? AND changes()=1`, now, now, draft.id)
    ]);
    return (await this.get(draft.id))!;
  }
  async cancel(id: string): Promise<void> {
    const d = await this.get(id);
    if (!d || ['publishing','published','cancelled'].includes(d.status)) throw new UserError('This entry cannot be cancelled. Use /status to check it.');
    await this.store.db.batch([
      this.store.stmt("UPDATE journal_drafts SET status='cancelled',revision=revision+1,title=NULL,ai_preview=NULL,ai_reflection=NULL,ai_question=NULL,updated_at=? WHERE id=?", Date.now(), id),
      this.store.stmt('DELETE FROM journal_draft_messages WHERE draft_id=?', id)
    ]);
  }
  async edit(m: TgMessage): Promise<boolean> {
    const row = await this.store.first<{ draft_id: string }>(`SELECT m.draft_id FROM journal_draft_messages m
      JOIN journal_drafts d ON d.id=m.draft_id WHERE m.telegram_chat_id=? AND m.telegram_message_id=? AND d.telegram_user_id=?`, String(m.chat.id), m.message_id, this.store.owner);
    if (!row) return false;
    const d = (await this.get(row.draft_id))!;
    if (d.status === 'cancelled') return false;
    if (['publishing','published'].includes(d.status)) throw new UserError('That entry is already saving or saved. Source edits cannot update completed channel copies. Check the channel if you changed an original while it was being saved.');
    const type = messageType(m);
    const size = await this.store.first<{ n: number }>(`SELECT COALESCE(SUM(COALESCE(length(original_text),0)+COALESCE(length(original_caption),0)),0) AS n
      FROM journal_draft_messages WHERE draft_id=? AND telegram_message_id!=?`, d.id, m.message_id);
    if (!type || (size?.n ?? 0) + contentLength(m) > 48000) {
      await this.store.db.batch([
        this.store.stmt('UPDATE journal_draft_messages SET validation_error=? WHERE draft_id=? AND telegram_message_id=?', 'edited_original_invalid', d.id, m.message_id),
        this.store.stmt("UPDATE journal_drafts SET status='collecting',revision=revision+1,preview_revision=NULL,preview_seen_revision=NULL,ai_preview=NULL,ai_reflection=NULL,ai_question=NULL,title=NULL,preview_kind=NULL,updated_at=? WHERE id=?", Date.now(), d.id)
      ]);
      throw new UserError('The edited message is unsupported or exceeds the draft text limit. Restore a supported message or shorten it, then use /done.');
    }
    await this.store.db.batch([
      this.store.stmt('UPDATE journal_draft_messages SET validation_error=NULL,original_text=?,original_caption=?,message_type=?,media_group_id=? WHERE draft_id=? AND telegram_message_id=?',
        m.text ?? null, m.caption ?? null, type, m.media_group_id ?? null, d.id, m.message_id),
      this.store.stmt(`UPDATE journal_drafts SET status='collecting',revision=revision+1,preview_revision=NULL,preview_seen_revision=NULL,
        title=NULL,ai_preview=NULL,ai_reflection=NULL,ai_question=NULL,preview_kind=NULL,last_content_at=?,updated_at=? WHERE id=?`, Date.now(), Date.now(), d.id)
    ]);
    return true;
  }
  async continue(id: string): Promise<void> {
    const d = await this.get(id);
    if (!d || !['preview_ready','preparing','failed','collecting'].includes(d.status)) throw new UserError('This entry is closed or being saved.');
    await this.store.run(`UPDATE journal_drafts SET status='collecting',revision=revision+1,preview_revision=NULL,
      ai_preview=NULL,ai_reflection=NULL,ai_question=NULL,title=NULL,preview_kind=NULL,updated_at=? WHERE id=?`, Date.now(), id);
  }
}
