import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, message, telegramMock } from './helpers.ts';
import worker from '../src/index.ts';
import { Bot } from '../src/telegram/commands.ts';
import { botCommands } from '../src/telegram/menu.ts';
import { callback } from '../src/telegram/callbacks.ts';
import { manilaDate } from '../src/utils/dates.ts';

test('every menu command responds on its own, including usage instructions for commands needing arguments', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  for (const { command } of botCommands) {
    const e = env(); const before = mock.calls.length;
    const response = await worker.fetch(new Request('https://test/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': e.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 1, message: message(1, '/' + command) })
    }), e);
    assert.equal(response.status, 200, command);
    const replies = mock.calls.slice(before).filter(c => c.method === 'sendMessage');
    assert.ok(replies.length, `${command} must reply`);
    assert.doesNotMatch(replies.at(-1)!.body.text, /^Use \/help to see the commands/, command);
    assert.equal((await new Bot(e).store.first<{ n: number }>('SELECT COUNT(*) AS n FROM journal_draft_messages'))?.n, 0, command);
  }
});

test('command whitespace, capitalization and bot mentions do not become journal notes; original text stays exact', async t => {
  const mock = telegramMock();
  t.mock.method(globalThis, 'fetch', (async (input, init) => String(input).endsWith('/getMe')
    ? Response.json({ ok: true, result: { id: 123, username: 'edjay_reminder_bot' } })
    : mock.fetch(input, init)) as typeof fetch);
  const bot = new Bot(env()); await bot.command(message(1, '  /JOURNAL\n'), 1);
  for (const [i, command] of [' /STATUS  ', '/help@edjay_reminder_bot', '/invalid-command', '/other@another_bot'].entries()) {
    await bot.command(message(i + 2, command), i + 2);
  }
  const original = '  I wrote /help in my notes.\nExact spacing.  ';
  await bot.command(message(10, original), 10);
  const draft = await bot.drafts.selected();
  assert.deepEqual((await bot.drafts.messages(draft.id)).map(m => m.original_text), [original]);
});

test('a saved day allows a new draft, with earlier archives and repeated saves preserved', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(env()); const today = manilaDate();
  async function save(id: number, text: string) {
    await bot.command(message(id, '/journal'), id);
    const draft = await bot.drafts.selected();
    await bot.command(message(id + 1, text), id + 1);
    await bot.command(message(id + 2, '/done'), id + 2);
    await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', draft.id);
    await bot.command(message(id + 3, '/save'), id + 3);
    return (await bot.drafts.get(draft.id))!;
  }
  const first = await save(1, 'Morning memory.');
  const firstArchive = await bot.publishing.archive(first.id);
  const second = await save(10, 'Evening memory.');
  assert.notEqual(first.id, second.id); assert.equal(second.entry_date, today);
  assert.equal(first.status, 'published'); assert.equal(second.status, 'published');
  assert.deepEqual(await bot.publishing.archive(first.id), firstArchive);
  const latestArchive = (await bot.publishing.archive(second.id))!;
  // Explicit timestamps make the latest-link assertion independent of clock resolution.
  await bot.store.run('UPDATE journal_archives SET created_at=created_at+1000 WHERE id=?', second.id);
  await bot.command(message(20, '/today'), 20);
  assert.ok(mock.calls.at(-1)!.body.text.endsWith('/' + latestArchive.first_channel_message_id));
  await bot.command(message(21, '/history'), 21);
  assert.ok(mock.calls.at(-1)!.body.text.includes('/' + firstArchive!.first_channel_message_id));
  assert.ok(mock.calls.at(-1)!.body.text.includes('/' + latestArchive.first_channel_message_id));
  const before = mock.calls.filter(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID).length;
  await bot.command(message(22, '/save'), 22);
  assert.equal(mock.calls.filter(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID).length, before);
  await bot.command(message(23, '/journal'), 23);
  const followup = await bot.drafts.selected();
  assert.equal(followup.status, 'collecting');
  assert.equal((await bot.drafts.start(today)).id, followup.id);
  assert.deepEqual((await bot.drafts.messages(first.id)).map(m => m.telegram_message_id), [2]);
  assert.deepEqual((await bot.drafts.messages(second.id)).map(m => m.telegram_message_id), [11]);
});

test('enable AI from an original preview, then done generates AI instead of reusing the original', async t => {
  const mock = telegramMock(); let generations = 0;
  const output = { language: 'english', entry_date: '2026-01-01', title: 'A walk with Ana', story: 'I walked home with Ana and felt tired.' };
  t.mock.method(globalThis, 'fetch', (async (input, init) => {
    if (String(input).includes('api.telegram.org')) return mock.fetch(input, init);
    if (!init?.body) return Response.json({ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] });
    generations++;
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });
  }) as typeof fetch);
  const bot = new Bot({ ...env(), AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'test', GEMINI_FREE_TIER_VERIFIED_UNTIL: manilaDate(Date.now() + 86400000) });
  const draft = await bot.drafts.start(output.entry_date);
  await bot.drafts.append(message(1, 'I walked home with Ana. I felt tired.'), 1);
  await bot.command(message(2, '/done'), 2);
  assert.equal(generations, 0);
  const preview = mock.calls.at(-1)!.body;
  assert.match(preview.text, /AI is off/);
  assert.ok(preview.reply_markup.inline_keyboard.flat().some((b: { callback_data: string }) => b.callback_data === 'ai'));
  await callback(bot, { id: 'enable', from: { id: 42 }, message: message(3), data: 'ai' });
  assert.equal((await bot.store.settings()).ai_consent, 0);
  const nonce = (await bot.store.settings()).consent_nonce!;
  await callback(bot, { id: 'consent', from: { id: 42 }, message: message(4), data: 'a:' + nonce });
  await bot.command(message(5, '/done'), 5);
  assert.equal(generations, 1); assert.equal((await bot.drafts.get(draft.id))?.preview_kind, 'ai');
  assert.match(mock.calls.at(-1)!.body.text, /AI-edited preview/);
  await bot.command(message(6, '/done'), 6); assert.equal(generations, 1);
  await bot.command(message(7, '/regenerate'), 7); assert.equal(generations, 2);
  await bot.command(message(8, '/revise Keep all details.'), 8); assert.equal(generations, 3);
  assert.equal(mock.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID), false);
  await bot.command(message(9, '/continue'), 9);
  assert.equal((await bot.drafts.get(draft.id))?.status, 'collecting');
  assert.equal((await bot.drafts.messages(draft.id))[0].original_text, 'I walked home with Ana. I felt tired.');
});
