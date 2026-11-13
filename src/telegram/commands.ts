import type { Env } from '../config/env.ts';
import { Store } from '../database/queries.ts';
import type { Archive, Draft } from '../database/types.ts';
import { Drafts } from '../journal/drafts.ts';
import { Entries, cb } from '../journal/entries.ts';
import { Publishing } from '../journal/publishing.ts';
import { Telegram } from './api.ts';
import { channelLink, keyboard } from './formatting.ts';
import type { TgMessage } from './types.ts';
import { aiConfigured } from '../ai/gemini.ts';
import { manilaDate } from '../utils/dates.ts';
import { UserError } from '../utils/errors.ts';
import { deliverReminder } from '../reminders/scheduled.ts';

export const helpText = `A little of your life, one day at a time.\n\n/journal — start or resume today\n/date YYYY-MM-DD — select a past day\n/done — prepare a preview\n/preview — read the preview\n/save — approve and save the preview\n/save original — save exact originals\n/revise your request — revise with AI\n/cancel — cancel with confirmation\n/status — selected draft and progress\n/today — today's saved entry\n/history — recent saved dates and links\n/ai_on — review AI privacy and consent\n/ai_off — stop future AI processing\n/privacy — storage and privacy\n/settings — schedule and AI status\n/id — your Telegram ID\n/help — this guide\n\nSend text, photos, albums, videos, voice, audio, or documents after /journal. Nothing is saved to the channel until you approve.\n\nRecovery: /recover ITEM destination_IDs, /recover ITEM retry, or /recover ITEM map:source=destination. /reminder retries today's reminder after you check it was not delivered. See README before using recovery.`;

export class Bot {
  env: Env; tg: Telegram; store: Store; drafts: Drafts; entries: Entries; publishing: Publishing;
  constructor(env: Env) {
    this.env = env; this.tg = new Telegram(env.TELEGRAM_BOT_TOKEN); this.store = new Store(env.DB, env.OWNER_TELEGRAM_ID);
    this.drafts = new Drafts(this.store); this.entries = new Entries(this.drafts, env, this.tg); this.publishing = new Publishing(this.drafts, env, this.tg);
  }
  send(text: string, keys?: ReturnType<typeof keyboard>): Promise<number[]> { return this.tg.send(this.env.OWNER_TELEGRAM_ID, text, keys); }
  async start(date?: string): Promise<void> {
    const d = await this.drafts.start(date);
    if (d.status === 'published') { await this.saved(d); return; }
    if (d.status === 'publishing') { await this.send('This entry is partway through saving. Use /status, then /save to continue.'); return; }
    await this.send(`Your ${d.entry_date} draft is ${d.status === 'preview_ready' ? 'ready for review' : 'open'}.\n\nWhat happened? How did you feel? What would you like to remember?\n\nWrite as much or as little as you like. Send /done when you are ready.`,
      keyboard([['Prepare Entry', cb('d', d)], ['Preview', cb('p', d, 0)]]));
  }
  async saved(d: Draft): Promise<void> {
    const a = await this.publishing.archive(d.id);
    await this.send(a?.first_channel_message_id ? `Saved ${a.journal_date}.\n${channelLink(a.channel_id, a.first_channel_message_id)}` : 'No completed archive link is available yet. Use /status.');
  }
  async prepare(d: Draft, regenerate = false, revision?: string): Promise<void> {
    const prepared = await this.entries.prepare(d, regenerate, revision);
    await this.entries.preview(prepared.draft, 0, prepared.warning);
  }
  async save(d: Draft, original = false): Promise<void> {
    const result = await this.publishing.save(d, original ? 'original' : d.preview_kind === 'ai' ? 'ai' : 'original');
    if (result.done) await this.send(`Your journal is saved.\n${result.link}`);
    else await this.send(`Saved progress. ${result.remaining} archive steps remain. Tap Continue Save or send /save.`, keyboard([['Continue Save', cb('s', d)]]));
  }
  async confirmCancel(d: Draft): Promise<void> {
    if (['published','publishing','cancelled'].includes(d.status)) throw new UserError('This entry cannot be cancelled. Use /status to check it.');
    await this.send(`Cancel the unfinished ${d.entry_date} draft? Its temporary draft text will be removed. Messages in this bot conversation remain.`,
      keyboard([['Yes, cancel draft', cb('c', d)], ['Keep writing', cb('w', d)]]));
  }
  async command(message: TgMessage, update: number): Promise<void> {
    const text = message.text ?? '';
    const command = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text);
    if (!command) {
      const d = await this.drafts.append(message, update);
      // Albums may arrive as separate updates. Acknowledge only caption/text and single media.
      if (!message.media_group_id) await this.send('Added to your draft. Keep writing, or send /done.', keyboard([['Prepare Entry', cb('d', d)]]));
      return;
    }
    const [, name, mention, raw = ''] = command; const arg = raw.trim();
    if (mention) {
      const me = await this.tg.call<{ username: string }>('getMe');
      if (mention.toLowerCase() !== me.username?.toLowerCase()) return;
    }
    if (!['date','save','revise','recover'].includes(name) && arg) throw new UserError('That command does not take extra text. Use /help for the command list.');
    switch (name) {
      case 'start': await this.send('📖 My Life, One Day at a Time\n\nA calm place to collect your day. Write, preview, then choose what to save in your private archive. Short entries are welcome. Use /help for all commands.', keyboard([['Start Journal', 'j']])); break;
      case 'help': await this.send(helpText); break;
      case 'id': await this.send(`Your Telegram account ID: ${this.env.OWNER_TELEGRAM_ID}`); break;
      case 'journal': await this.start(); break;
      case 'date': await this.start(arg); break;
      case 'done': await this.prepare(await this.drafts.selected()); break;
      case 'preview': await this.entries.preview(await this.drafts.selected()); break;
      case 'save':
        if (arg && arg !== 'original') throw new UserError('Use /save or /save original.');
        await this.save(await this.drafts.selected(), arg === 'original'); break;
      case 'revise':
        if (!arg || arg.length > 800) throw new UserError('Use /revise followed by a short wording request (up to 800 characters). Your originals stay intact.');
        await this.prepare(await this.drafts.selected(), true, arg); break;
      case 'cancel': await this.confirmCancel(await this.drafts.selected()); break;
      case 'history': {
        const rows = await this.store.all<Archive>(`SELECT a.* FROM journal_archives a JOIN journal_drafts d ON d.id=a.draft_id
          WHERE a.status='published' AND d.telegram_user_id=? ORDER BY a.journal_date DESC LIMIT 15`, this.store.owner);
        await this.send(rows.length ? rows.map(a => `${a.journal_date} — ${a.title}\n${channelLink(a.channel_id, a.first_channel_message_id!)}`).join('\n\n') : 'Your archive is waiting for its first day. Use /journal whenever you are ready.'); break;
      }
      case 'today': {
        const a = await this.store.first<Archive>(`SELECT a.* FROM journal_archives a JOIN journal_drafts d ON d.id=a.draft_id
          WHERE a.journal_date=? AND a.status='published' AND d.telegram_user_id=?`, manilaDate(), this.store.owner);
        await this.send(a ? `Today is saved.\n${channelLink(a.channel_id, a.first_channel_message_id!)}` : 'Today has not been saved yet. Use /journal whenever you are ready.'); break;
      }
      case 'status': {
        const d = await this.drafts.selected(); const messages = await this.drafts.messages(d.id);
        const pending = await this.store.all<{ id: number; copy_status: string; source_message_ids: string; destination_message_ids: string }>(
          "SELECT id,copy_status,source_message_ids,destination_message_ids FROM archive_items WHERE archive_id=? AND copy_status!='done' ORDER BY sequence LIMIT 5", d.id);
        if (d.status === 'published') { await this.saved(d); break; }
        await this.send(`${d.entry_date}: ${d.status.replace('_', ' ')}\n${messages.length} original messages collected.` +
          (pending.length ? '\n\nPending archive items:\n' + pending.map(p => `${p.id}: ${p.copy_status}; sources ${p.source_message_ids}; destinations ${p.destination_message_ids}`).join('\n') : '') +
          (d.status === 'preparing' ? '\nAn earlier preparation was interrupted. Use /done to prepare again or Continue Writing to reopen.' : ''),
          keyboard([['Preview', cb('p', d, 0)], ['Continue Writing', cb('w', d)]])); break;
      }
      case 'privacy': await this.send('Your bot conversation and private channel are stored by Telegram. Private channels are not end-to-end encrypted. The channel is your main archive.\n\nCloudflare D1 temporarily stores unfinished text/captions and previews, plus message references, settings, delivery state, and archive metadata. Text and previews are removed from live D1 rows after a complete save; backups may retain earlier copies briefly. No media is downloaded or stored by this app.\n\nGemini is optional and starts off. With your consent, journal text, media captions, and revision requests are sent to Google. Free-tier data may be used to improve Google products under its terms. Gemini Plus does not include API credits. Photos, videos, and audio are never sent to Gemini; voice notes are not transcribed. /ai_off stops future requests.\n\nKeep original bot messages until saving finishes. The Bot API cannot generally fetch arbitrary channel history for future AI summaries.'); break;
      case 'settings': {
        const settings = await this.store.settings();
        await this.send(`Reminder: around 7 PM, Asia/Manila (UTC+8), daily.\nAI consent: ${settings.ai_consent ? 'on' : 'off'}.\nAI setup: ${aiConfigured(this.env) ? 'verified configuration (expires; project billing must remain disabled)' : 'disabled or verification expired'}.\nAI attempts: at most 3 per draft and 10 per Philippine day.\nImages and audio: archive only.\nUse /ai_on or /ai_off.`); break;
      }
      case 'ai_on': {
        if (!aiConfigured(this.env)) throw new UserError('AI is off in setup or its free-project verification has expired. You can keep journaling and saving originals. See the optional AI setup guide.');
        await this.store.settings();
        const nonce = crypto.randomUUID();
        await this.store.run('UPDATE app_settings SET consent_nonce=?,consent_expires_at=?,updated_at=? WHERE owner_id=?', nonce, Date.now() + 600000, Date.now(), this.store.owner);
        await this.send('Enable Gemini for future preparations?\n\nJournal text, original media captions, and revision requests will be sent to Google’s API. Free-tier API data may be used to improve Google products under its applicable terms. Gemini Plus does not automatically include API credits. Only a separately verified API project with billing disabled may be used.\n\nImages, videos, and audio are excluded. AI may make mistakes: review before saving. You can stop future requests with /ai_off. This confirmation expires in 10 minutes.', keyboard([['I agree — enable text AI', 'a:' + nonce], ['Keep AI off', 'off']])); break;
      }
      case 'ai_off': await this.disableAi(); break;
      case 'recover': {
        const match = /^(\d+) (\S+)$/.exec(arg);
        if (!match) throw new UserError('Use /recover ITEM retry or /recover ITEM destination_IDs. Read the recovery guide first.');
        await this.publishing.recover(await this.drafts.selected(), Number(match[1]), match[2]);
        await this.send('Recovery recorded. Use /save to continue.'); break;
      }
      case 'reminder': await deliverReminder(this.env, this.store, this.tg, Date.now(), true); break;
      default: await this.send('Use /help to see the commands, or /journal to start writing.');
    }
  }
  async disableAi(): Promise<void> {
    await this.store.settings();
    await this.store.run('UPDATE app_settings SET ai_consent=0,consent_nonce=NULL,consent_expires_at=NULL,updated_at=? WHERE owner_id=?', Date.now(), this.store.owner);
    await this.send('AI is off for future requests. You can keep writing and saving originals. Existing previews remain available for your review.');
  }
}
