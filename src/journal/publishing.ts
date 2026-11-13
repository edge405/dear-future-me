import type { Archive, ArchiveItem, Draft } from '../database/types.ts';
import type { Env } from '../config/env.ts';
import { Telegram } from '../telegram/api.ts';
import { Drafts } from './drafts.ts';
import { notesFrom } from './entries.ts';
import { chunks, channelLink, journalHeading } from '../telegram/formatting.ts';
import { copyBatches } from '../telegram/media.ts';
import { currentAiPreview } from '../ai/validation.ts';
import { TelegramError, UserError } from '../utils/errors.ts';

export class Publishing {
  drafts: Drafts; env: Env; tg: Telegram;
  constructor(drafts: Drafts, env: Env, tg: Telegram) { this.drafts = drafts; this.env = env; this.tg = tg; }
  async archive(draft: string): Promise<Archive | null> {
    return this.drafts.store.first<Archive>('SELECT * FROM journal_archives WHERE draft_id=?', draft);
  }
  async save(d: Draft, kind: 'original' | 'ai'): Promise<{ done: boolean; link?: string; remaining?: number }> {
    const s = this.drafts.store;
    let archive = await this.archive(d.id);
    if (d.status === 'published' && archive?.first_channel_message_id)
      return { done: true, link: channelLink(archive.channel_id, archive.first_channel_message_id) };
    if (archive && archive.channel_id !== this.env.JOURNAL_CHANNEL_ID) {
      throw new UserError('The archive channel setting changed during this save. Restore the original channel before continuing.');
    }
    // Recheck privacy and permission on every continuation, including after configuration changes.
    if (archive) await this.tg.verifyChannel(archive.channel_id, s.owner);
    if (!archive) {
      if (d.status !== 'preview_ready' || d.preview_revision !== d.revision || d.preview_seen_revision !== d.revision)
        throw new UserError('Use /done and read the preview through its last page before saving. Nothing has been published.');
      if (kind === 'ai' && (d.preview_kind !== 'ai' || !d.ai_preview)) throw new UserError('This preview has no AI story. Choose Save Original.');
      if (kind === 'ai' && !currentAiPreview(d)) throw new UserError('This AI preview uses the previous format. Use /done for a fresh one-paragraph preview, or /save original.');
      if (Date.now() - d.last_content_at < 3000) throw new UserError('Please wait a few seconds for any remaining album messages, then save again.');
      await this.tg.verifyChannel(this.env.JOURNAL_CHANNEL_ID, s.owner);
      const messages = await this.drafts.messages(d.id);
      const title = kind === 'ai' ? d.title! : 'My day';
      const items: { type: string; sources: number[]; text: string | null }[] = [
        { type: 'heading', sources: [], text: journalHeading(d.entry_date, title).text }
      ];
      const story = kind === 'ai' ? d.ai_preview! : notesFrom(messages).join('\n\n');
      for (const text of chunks(story)) items.push({ type: 'story', sources: [], text });
      for (const sources of copyBatches(messages)) items.push({ type: 'copy', sources, text: null });
      const now = Date.now();
      await s.db.batch([
        s.stmt(`INSERT INTO journal_archives(id,draft_id,journal_date,title,channel_id,original_message_count,status,created_at)
          VALUES (?,?,?,?,?,?,'publishing',?)`, d.id, d.id, d.entry_date, title, this.env.JOURNAL_CHANNEL_ID, messages.length, now),
        s.stmt(`INSERT INTO archive_items(archive_id,sequence,item_type,source_message_ids,payload)
          SELECT ?,CAST(key AS INTEGER),json_extract(value,'$.type'),json_extract(value,'$.sources'),json_extract(value,'$.text') FROM json_each(?)`, d.id, JSON.stringify(items)),
        s.stmt("UPDATE journal_drafts SET status='publishing',approved_kind=?,updated_at=? WHERE id=?", kind, now, d.id)
      ]);
      archive = (await this.archive(d.id))!;
    }
    // Any leftover inflight operation may already have succeeded externally. Never replay it.
    await s.run("UPDATE archive_items SET copy_status='uncertain',error_code='interrupted' WHERE archive_id=? AND copy_status='inflight'", archive.id);
    for (let step = 0; step < 3; step++) {
      const item = await s.first<ArchiveItem>("SELECT * FROM archive_items WHERE archive_id=? AND copy_status!='done' ORDER BY sequence LIMIT 1", archive.id);
      if (!item) break;
      if (item.copy_status === 'uncertain') throw new UserError(await this.recoveryMessage(item));
      if (item.retry_at > Date.now()) throw new UserError('Telegram asked us to pause. Your progress is safe; retry /save in a little while.');
      await s.run("UPDATE archive_items SET copy_status='inflight',error_code=NULL WHERE id=?", item.id);
      let ids: number[];
      try {
        const sources = JSON.parse(item.source_message_ids) as number[];
        if (item.item_type === 'copy') {
          const result = sources.length === 1
            ? [await this.tg.call<{ message_id: number }>('copyMessage', { chat_id: archive.channel_id, from_chat_id: s.owner, message_id: sources[0] })]
            : await this.tg.call<{ message_id: number }[]>('copyMessages', { chat_id: archive.channel_id, from_chat_id: s.owner, message_ids: sources });
          ids = result.map(m => m.message_id);
          if (ids.length !== sources.length) {
            // A zero-result batch is a definite skip; partial non-empty results cannot be mapped.
            await s.run('UPDATE archive_items SET copy_status=?,destination_message_ids=?,error_code=? WHERE id=?',
              ids.length ? 'uncertain' : 'failed', JSON.stringify(ids), 'skipped_sources', item.id);
            throw new UserError(ids.length ? await this.recoveryMessage({ ...item, destination_message_ids: JSON.stringify(ids) }) :
              `Telegram could not copy source messages ${sources.join(', ')}. Keep them in the bot chat and retry /save after resolving the problem. Your draft is preserved.`);
          }
        } else {
          const heading = journalHeading(archive.journal_date, archive.title);
          // Frozen legacy plans continue unchanged; only new headings receive title entities.
          ids = await this.tg.send(archive.channel_id, item.payload!, undefined,
            item.item_type === 'heading' && item.payload === heading.text ? heading.entities : undefined);
        }
        if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new TelegramError(0, true);
      } catch (error) {
        if (error instanceof UserError) throw error;
        if (error instanceof TelegramError) {
          await s.run('UPDATE archive_items SET copy_status=?,error_code=?,retry_at=? WHERE id=?', error.ambiguous ? 'uncertain' : 'failed',
            'telegram_' + error.code, Date.now() + error.retryAfter * 1000, item.id);
          if (error.ambiguous) throw new UserError(await this.recoveryMessage(item));
          throw new UserError(`Saving paused at item ${item.id} (source messages ${item.source_message_ids}). Check channel permissions and source availability, then retry /save. Successful items will be kept.`);
        }
        // A D1 failure is deliberately left inflight; recovery will classify it as uncertain.
        throw error;
      }
      await s.db.batch([
        s.stmt("UPDATE archive_items SET copy_status='done',destination_message_ids=?,payload=NULL,copied_at=? WHERE id=?", JSON.stringify(ids), Date.now(), item.id),
        s.stmt('UPDATE journal_archives SET first_channel_message_id=COALESCE(first_channel_message_id,?) WHERE id=?', ids[0], archive.id)
      ]);
    }
    const pending = (await s.first<{ n: number }>("SELECT COUNT(*) AS n FROM archive_items WHERE archive_id=? AND copy_status!='done'", archive.id))!.n;
    if (pending) return { done: false, remaining: pending };
    await s.db.batch([
      s.stmt("UPDATE journal_archives SET status='published',published_at=? WHERE id=?", Date.now(), archive.id),
      s.stmt(`UPDATE journal_drafts SET status='published',title=NULL,ai_preview=NULL,ai_reflection=NULL,ai_question=NULL,updated_at=? WHERE id=?`, Date.now(), d.id),
      s.stmt('UPDATE journal_draft_messages SET original_text=NULL,original_caption=NULL WHERE draft_id=?', d.id),
      s.stmt('UPDATE archive_items SET payload=NULL WHERE archive_id=?', archive.id)
    ]);
    archive = (await this.archive(d.id))!;
    return { done: true, link: channelLink(archive.channel_id, archive.first_channel_message_id!) };
  }
  async recoveryMessage(item: ArchiveItem): Promise<string> {
    return `Saving paused: item ${item.id} has an uncertain result. Source messages: ${item.source_message_ids}. Returned channel IDs: ${item.destination_message_ids}.\n\nInspect the channel before continuing. If every source was copied, use /recover ${item.id} followed by all destination IDs in source order, comma-separated. If incomplete, remove any copies from this item first, then use /recover ${item.id} retry. See the recovery guide for mapping individual items. Other completed items will not be repeated.`;
  }
  async recover(d: Draft, itemId: number, action: string): Promise<void> {
    if (d.status !== 'publishing') throw new UserError('No interrupted publication is selected.');
    const s = this.drafts.store;
    const item = await s.first<ArchiveItem>("SELECT * FROM archive_items WHERE id=? AND archive_id=? AND copy_status IN ('uncertain','inflight','failed')", itemId, d.id);
    if (!item) throw new UserError('That item does not need reconciliation in the selected entry.');
    if (action === 'retry') {
      await s.run("UPDATE archive_items SET copy_status='pending',destination_message_ids='[]',retry_at=0,error_code=NULL WHERE id=?", item.id);
      return;
    }
    // map:source=destination,... can resolve a partially returned batch without recopying completed sources.
    const sources = JSON.parse(item.source_message_ids) as number[];
    if (action.startsWith('map:') && item.item_type === 'copy') {
      const pairs = action.slice(4).split(',').map(p => p.split('=').map(Number));
      const returned = JSON.parse(item.destination_message_ids) as number[];
      if (!pairs.length || pairs.some(p => p.length !== 2 || !sources.includes(p[0]) || !Number.isSafeInteger(p[1]) || p[1] < 1) ||
        new Set(pairs.map(p => p[0])).size !== pairs.length || new Set(pairs.map(p => p[1])).size !== pairs.length ||
        returned.some(id => !pairs.some(p => p[1] === id))) throw new UserError('Map every returned channel ID exactly once to its original source ID. See the recovery guide.');
      const missing = sources.filter(id => !pairs.some(p => p[0] === id));
      const destinations = sources.filter(id => !missing.includes(id)).map(id => pairs.find(p => p[0] === id)![1]);
      await s.db.batch([
        s.stmt("UPDATE archive_items SET source_message_ids=?,destination_message_ids=?,copy_status='done',payload=NULL,copied_at=? WHERE id=?", JSON.stringify(sources.filter(id => !missing.includes(id))), JSON.stringify(destinations), Date.now(), item.id),
        s.stmt(`INSERT INTO archive_items(archive_id,sequence,item_type,source_message_ids)
          SELECT ?,COALESCE(MAX(sequence),0)+1,'copy',? FROM archive_items WHERE archive_id=? HAVING ? > 0`, d.id, JSON.stringify(missing), d.id, missing.length)
      ]);
      return;
    }
    if (!/^\d+(,\d+)*$/.test(action)) throw new UserError('Use retry, destination IDs separated by commas, or map:source=destination.');
    const ids = action.split(',').map(Number);
    const expected = item.item_type === 'copy' ? sources.length : 1;
    if (ids.length !== expected || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new UserError('Supply one valid destination ID for every original in this item, in source order.');
    await s.db.batch([
      s.stmt("UPDATE archive_items SET copy_status='done',destination_message_ids=?,payload=NULL,copied_at=? WHERE id=?", JSON.stringify(ids), Date.now(), item.id),
      s.stmt('UPDATE journal_archives SET first_channel_message_id=COALESCE(first_channel_message_id,?) WHERE id=?', ids[0], d.id)
    ]);
  }
}
