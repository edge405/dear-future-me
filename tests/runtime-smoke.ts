import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare, Response as MfResponse, convertV4MiniflareOptions } from 'miniflare';
import type { Request as MfRequest } from 'miniflare';
import { languageFixtures } from './fixtures/journal-languages.ts';
import { manilaDate } from '../src/utils/dates.ts';

type RuntimeContext = {
  db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  calls: { method: string; body: Record<string, any> }[];
  send(text?: string, media?: Record<string, unknown>): Promise<number>;
  press(data: string): Promise<void>;
};

async function withRuntime(ai: boolean, run: (context: RuntimeContext) => Promise<void>) {
  const calls: { method: string; body: Record<string, any> }[] = [];
  let destination = 100;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: resolve('dist/index.js'), compatibilityDate: '2026-11-13',
    d1Databases: ['DB'],
    bindings: { TELEGRAM_BOT_TOKEN: '123:test', TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(40), OWNER_TELEGRAM_ID: '42', JOURNAL_CHANNEL_ID: '-1001234567890',
      AI_ENABLED: ai ? 'true' : 'false', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_VERIFIED_UNTIL: manilaDate(Date.now() + 86400000) },
    outboundService: async (request: MfRequest) => {
      // Every external request is intercepted. No Telegram or Gemini credentials are used.
      if (new URL(request.url).hostname === 'generativelanguage.googleapis.com') {
        if (request.method === 'GET') return new MfResponse(JSON.stringify({ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }));
        const body = await request.json() as Record<string, any>;
        const input = JSON.parse(body.contents[0].parts[0].text); calls.push({ method: 'generateContent', body: input });
        const output = { ...languageFixtures[2].edited, entry_date: input.entry_date };
        return new MfResponse(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] }));
      }
      assert.equal(new URL(request.url).hostname, 'api.telegram.org');
      const method = request.url.split('/').at(-1)!; const body = await request.json() as Record<string, any>;
      calls.push({ method, body }); let result: unknown = true;
      if (method === 'getMe') result = { id: 123 };
      if (method === 'getChat') result = { id: -1001234567890, type: 'channel' };
      if (method === 'getChatMember') result = body.user_id === 42 ? { status: 'creator' } : { status: 'administrator', can_post_messages: true };
      if (method === 'getChatMemberCount') result = 2;
      if (method === 'sendMessage' || method === 'copyMessage') result = { message_id: destination++ };
      if (method === 'copyMessages') result = body.message_ids.map(() => ({ message_id: destination++ }));
      return new MfResponse(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
    }
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve('migrations', file), 'utf8'); const trigger = sql.indexOf('CREATE TRIGGER');
      const statements = (trigger < 0 ? sql : sql.slice(0, trigger)).split(';').filter(s => s.trim());
      if (trigger >= 0) statements.push(sql.slice(trigger));
      for (const statement of statements) await db.prepare(statement).run();
    }
    assert.equal((await mf.dispatchFetch('https://test/health')).status, 200);
    let update = 0;
    const dispatch = async (body: Record<string, unknown>) => {
      const response = await mf.dispatchFetch('https://test/telegram/webhook', {
        method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'x'.repeat(40) },
        body: JSON.stringify({ update_id: update, ...body })
      });
      assert.equal(response.status, 200, await response.text());
    };
    const send = async (text?: string, media?: Record<string, unknown>) => {
      update++;
      await dispatch({ message: { message_id: update, date: 1700000000 + update,
        chat: { id: 42, type: 'private' }, from: { id: 42 }, ...(text === undefined ? {} : { text }), ...media } });
      return update;
    };
    const press = async (data: string) => {
      update++;
      await dispatch({ callback_query: { id: 'callback-' + update, from: { id: 42 }, data,
        message: { message_id: update, date: 1700000000 + update, chat: { id: 42, type: 'private' }, from: { id: 123, is_bot: true } } } });
    };
    await run({ db, calls, send, press });
  } finally { await mf.dispose(); }
}

test('Cloudflare workerd runtime executes migrations and the complete original-only webhook workflow', async () => {
  await withRuntime(false, async ({ db, calls, send }) => {
    await send('/journal'); await send('An actual runtime test.'); await send('Second original message.'); await send('/done');
    assert.equal(calls.some(c => c.body.chat_id === '-1001234567890'), false);
    await db.prepare('UPDATE journal_drafts SET last_content_at=0').run();
    await send('/save');
    assert.equal((await db.prepare('SELECT status FROM journal_drafts').first())?.status, 'published');
    assert.equal((await db.prepare('SELECT original_text FROM journal_draft_messages LIMIT 1').first())?.original_text, null);
    assert.deepEqual(calls.find(c => c.method === 'copyMessages')?.body.message_ids, [2,3]);
    const before = calls.filter(c => c.body.chat_id === '-1001234567890').length;
    await send('/save'); assert.equal(calls.filter(c => c.body.chat_id === '-1001234567890').length, before);
    const result = await db.prepare('SELECT COUNT(*) AS n FROM processed_updates').first<{ n: number }>();
    assert.equal(result?.n, 6);
    await send('/journal');
    const followup = await send('Another memory from the same day.'); await send('/done');
    await db.prepare('UPDATE journal_drafts SET last_content_at=0').run(); await send('/save');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM journal_archives WHERE status='published'").first())?.n, 2);
    assert.equal(calls.filter(c => c.method === 'copyMessage').at(-1)?.body.message_id, followup);
  });
});

test('Cloudflare runtime handles one-paragraph Taglish AI preview, consent, media, approval, and title styling', async () => {
  await withRuntime(true, async ({ db, calls, send, press }) => {
    await send('/date 2026-01-01');
    const sources: number[] = [];
    for (const note of languageFixtures[2].notes) sources.push(await send(note));
    sources.push(await send(undefined, { photo: [{}] }));
    sources.push(await send(undefined, { video: {} }));
    await send('/done');
    assert.equal(calls.some(c => c.method === 'generateContent'), false);
    assert.ok(calls.at(-1)!.body.text.includes('AI is off'));
    await press('ai');
    const consent = calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data;
    await press(consent);
    assert.equal((await db.prepare('SELECT ai_consent FROM app_settings').first())?.ai_consent, 1);
    await send('/done');
    assert.equal(calls.some(c => c.body.chat_id === '-1001234567890'), false);
    assert.deepEqual(calls.find(c => c.method === 'generateContent')?.body.notes, languageFixtures[2].notes);
    const preview = calls.filter(c => c.method === 'sendMessage').at(-1)!.body;
    assert.ok(preview.text.includes(languageFixtures[2].edited.story));
    assert.equal(preview.text.includes('AI reflection'), false);
    assert.equal(preview.entities[0].type, 'bold');
    await db.prepare('UPDATE journal_drafts SET last_content_at=0').run();
    await send('/save');
    const state = await db.prepare('SELECT status,approved_kind,ai_preview FROM journal_drafts').first();
    assert.equal(state?.status, 'published'); assert.equal(state?.approved_kind, 'ai'); assert.equal(state?.ai_preview, null);
    const archived = calls.filter(c => c.body.chat_id === '-1001234567890' && c.method === 'sendMessage');
    assert.equal(archived.length, 2); assert.equal(archived[0].body.entities[0].type, 'bold');
    assert.equal(archived[1].body.text, languageFixtures[2].edited.story);
    assert.deepEqual(calls.find(c => c.method === 'copyMessages')?.body.message_ids, sources);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM archive_items WHERE item_type='reflection'").first())?.n, 0);
  });
});
