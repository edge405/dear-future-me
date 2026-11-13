import { Drafts } from './drafts.ts';
import type { Draft, DraftMessage } from '../database/types.ts';
import type { Env } from '../config/env.ts';
import { Telegram } from '../telegram/api.ts';
import { chunks, keyboard, journalHeading } from '../telegram/formatting.ts';
import { manilaDate } from '../utils/dates.ts';
import { UserError } from '../utils/errors.ts';
import { aiConfigured, aiFailure, generate } from '../ai/gemini.ts';
import { currentAiPreview } from '../ai/validation.ts';

export const notesFrom = (messages: DraftMessage[]): string[] => messages.flatMap(m =>
  [m.original_text, m.original_caption].filter((v): v is string => v !== null && v.length > 0));

export const cb = (action: string, draft: Draft, extra?: number): string =>
  `${action}:${draft.id}:${draft.revision}${extra === undefined ? '' : ':' + extra}`;

export class Entries {
  drafts: Drafts; env: Env; tg: Telegram;
  constructor(drafts: Drafts, env: Env, tg: Telegram) { this.drafts = drafts; this.env = env; this.tg = tg; }
  async prepare(d: Draft, regenerate = false, revision?: string): Promise<{ draft: Draft; warning?: string }> {
    if (['publishing','published','cancelled'].includes(d.status)) throw new UserError('This entry is closed or being saved. Use /journal for a new draft, or /status to check a save in progress.');
    const settings = await this.drafts.store.settings();
    // An original preview prepared before consent must not mask newly enabled AI.
    const newlyEnabled = d.preview_kind === 'original' && d.ai_attempts === 0 && settings.ai_consent && aiConfigured(this.env);
    if (d.status === 'preview_ready' && !regenerate && !revision && !newlyEnabled && (d.preview_kind !== 'ai' || currentAiPreview(d))) return { draft: d };
    const messages = await this.drafts.messages(d.id);
    if (!messages.length) throw new UserError('Send a few words or a memory first. Short entries are welcome.');
    if (messages.some(m => m.validation_error)) throw new UserError('An edited original needs attention. Restore a supported message type or shorten it, then prepare again. Your draft is preserved.');
    const s = this.drafts.store;
    await s.run("UPDATE journal_drafts SET status='preparing',updated_at=? WHERE id=?", Date.now(), d.id);
    let title = 'My day'; let story: string | null = null;
    let kind = 'original'; let warning: string | undefined;
    const notes = notesFrom(messages);
    if (settings.ai_consent && aiConfigured(this.env) && notes.length) {
      const today = manilaDate();
      await s.run('INSERT OR IGNORE INTO ai_usage(owner_id,usage_date,attempts) VALUES (?,?,0)', s.owner, today);
      const usage = (await s.first<{ attempts: number }>('SELECT attempts FROM ai_usage WHERE owner_id=? AND usage_date=?', s.owner, today))!;
      if (d.ai_attempts >= 3 || usage.attempts >= 10) warning = 'The local AI attempt limit has been reached. Your original entry is ready to save.';
      else {
        await s.db.batch([
          s.stmt('UPDATE ai_usage SET attempts=attempts+1 WHERE owner_id=? AND usage_date=?', s.owner, today),
          s.stmt('UPDATE journal_drafts SET ai_attempts=ai_attempts+1,ai_consent=1 WHERE id=?', d.id)
        ]);
        try {
          const previousStory = revision && d.preview_kind === 'ai' && currentAiPreview(d) ? d.ai_preview ?? undefined : undefined;
          const result = await generate(this.env, true, d.entry_date, notes, revision, previousStory);
          title = result.title; story = result.story; kind = 'ai';
        } catch (error) {
          warning = aiFailure(error);
          if (error instanceof Error && /^(ai_http_(400|401|402|403|404)|ai_model_unsupported)$/.test(error.message)) {
            await s.run('UPDATE app_settings SET ai_consent=0,consent_nonce=NULL,consent_expires_at=NULL WHERE owner_id=?', s.owner);
            warning += ' AI has been switched off until you review setup and consent again.';
          }
        }
      }
    } else if (!settings.ai_consent && notes.length) {
      warning = 'AI is off. Use /ai_on and confirm to enable it, then /done. Your original entry is ready to save.';
    } else if (regenerate || revision || (settings.ai_consent && !aiConfigured(this.env))) {
      warning = 'AI is disabled or its free-project verification has expired. Your original entry is ready to save.';
    }
    // Advance revision so buttons from earlier previews cannot authorize a different version.
    await s.run(`UPDATE journal_drafts SET status='preview_ready',revision=revision+1,preview_revision=revision+1,
      preview_seen_revision=NULL,title=?,ai_preview=?,ai_reflection=NULL,ai_question=NULL,preview_kind=?,updated_at=? WHERE id=?`,
      title, story, kind, Date.now(), d.id);
    return { draft: (await this.drafts.get(d.id))!, warning };
  }
  async preview(d: Draft, page = 0, warning?: string): Promise<void> {
    if (d.status !== 'preview_ready' || d.preview_revision !== d.revision) throw new UserError('Use /done to prepare the current draft first.');
    if (d.preview_kind === 'ai' && !currentAiPreview(d)) throw new UserError('This AI preview uses the previous format. Use /done for a fresh one-paragraph preview. Your originals are preserved.');
    const messages = await this.drafts.messages(d.id);
    const original = notesFrom(messages).join('\n\n');
    const story = d.preview_kind === 'ai' ? d.ai_preview : original || '(Media-only entry; no transcription or image analysis.)';
    const heading = journalHeading(d.entry_date, d.title!);
    const text = `${heading.text}\n\n${story}` +
      `\n\nOriginals to archive: ${messages.length} messages, ${new Set(messages.map(m => m.media_group_id).filter(Boolean)).size} albums. Originals and captions are copied separately in order. Check that all album items have arrived.`;
    const pages = chunks(text, 3200);
    if (!Number.isInteger(page) || page < 0 || page >= pages.length) throw new UserError('That preview page is unavailable. Use /preview.');
    const controls: [string, string][][] = [];
    const settings = await this.drafts.store.settings();
    if (d.preview_kind === 'original' && !settings.ai_consent) {
      warning ??= 'AI is off. Enable it below and confirm, then send /done for an AI preview. You can also save your originals.';
      controls.push([['Enable AI', 'ai']]);
    }
    const nav: [string, string][] = [];
    if (page) nav.push(['Previous', cb('p', d, page - 1)]);
    if (page + 1 < pages.length) nav.push(['Next preview', cb('p', d, page + 1)]);
    if (nav.length) controls.push(nav);
    if (page === pages.length - 1) {
      controls.push([['Save Journal', cb('s', d)], ['Save Original', cb('o', d)]]);
      controls.push([['Regenerate', cb('g', d)], ['Revise', cb('v', d)]]);
    }
    controls.push([['Continue Writing', cb('w', d)], ['Cancel', cb('x', d)]]);
    const prefix = `${warning ? warning + '\n\n' : ''}${d.preview_kind === 'ai' ? 'AI-edited preview — review before saving' : 'Original preview'} ${page + 1}/${pages.length}\n\n`;
    const entities = page === 0 ? heading.entities.map(entity => ({ ...entity, offset: entity.offset + prefix.length })) : undefined;
    await this.tg.send(this.env.OWNER_TELEGRAM_ID, prefix + pages[page], keyboard(...controls), entities);
    if (page === pages.length - 1) await this.drafts.store.run('UPDATE journal_drafts SET preview_seen_revision=? WHERE id=? AND revision=?', d.revision, d.id, d.revision);
  }
}
