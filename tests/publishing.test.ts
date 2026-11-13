import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, message, telegramMock } from './helpers.ts';
import { Bot } from '../src/telegram/commands.ts';
import { TelegramError } from '../src/utils/errors.ts';

async function ready(bot: Bot) {
  const draft = await bot.drafts.start('2026-01-01');
  await bot.drafts.append(message(1, 'A real day. <&>'), 1);
  const { draft: prepared } = await bot.entries.prepare((await bot.drafts.get(draft.id))!);
  await bot.entries.preview(prepared);
  await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', draft.id);
  return (await bot.drafts.get(draft.id))!;
}
test('preview never publishes; saving archives originals in order, purges text, and is repeat-safe', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(env()); const draft = await ready(bot);
  assert.equal(mock.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID), false);
  const result = await bot.publishing.save(draft, 'original');
  assert.equal(result.done, true); assert.match(result.link!, /^https:\/\/t.me\/c\/1234567890\/\d+$/);
  assert.equal((await bot.drafts.get(draft.id))?.status, 'published');
  assert.equal((await bot.drafts.messages(draft.id))[0].original_text, null);
  assert.equal(mock.calls.find(c => c.method === 'copyMessage')?.body.message_id, 1);
  const n = mock.calls.length;
  await bot.publishing.save((await bot.drafts.get(draft.id))!, 'original');
  assert.equal(mock.calls.length, n);
  await bot.save((await bot.drafts.get(draft.id))!);
  assert.match(mock.calls.at(-1)!.body.text, /Your journal is saved/);
});
test('collecting and unread previews cannot be published', async t => {
  t.mock.method(globalThis, 'fetch', telegramMock().fetch);
  const bot = new Bot(env()); const d = await bot.drafts.start('2026-01-01');
  await assert.rejects(bot.publishing.save(d, 'original'), /read the preview/);
  await bot.drafts.append(message(1, 'hello'), 1);
  const { draft } = await bot.entries.prepare((await bot.drafts.get(d.id))!);
  await assert.rejects(bot.publishing.save(draft, 'original'), /read the preview/);
});
test('definite copy failure retains draft and retries only the failed operation', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(env()); const d = await ready(bot);
  const call = bot.tg.call.bind(bot.tg); let fail = true;
  t.mock.method(bot.tg, 'call', async (method: string, body?: Record<string, unknown>) => {
    if (method === 'copyMessage' && fail) { fail = false; throw new TelegramError(400); }
    return call(method, body);
  });
  await assert.rejects(bot.publishing.save(d, 'original'), /Saving paused/);
  assert.equal((await bot.drafts.messages(d.id))[0].original_text, 'A real day. <&>');
  const before = mock.calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID).length;
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
  assert.equal(mock.calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID).length, before);
});
test('ambiguous network outcome stops automatic replay and requires reconciliation', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(env()); const d = await ready(bot);
  const call = bot.tg.call.bind(bot.tg);
  t.mock.method(bot.tg, 'call', async (method: string, body?: Record<string, unknown>) => {
    if (method === 'copyMessage') throw new TelegramError(0, true);
    return call(method, body);
  });
  await assert.rejects(bot.publishing.save(d, 'original'), /uncertain result/);
  const pending = await bot.store.first<{ id: number }>("SELECT id FROM archive_items WHERE archive_id=? AND copy_status='uncertain'", d.id);
  const count = mock.calls.length;
  await assert.rejects(bot.publishing.save((await bot.drafts.get(d.id))!, 'original'), /uncertain result/);
  assert.equal(mock.calls.length, count + 5); // Read-only permission/privacy recheck, no replay.
  await bot.publishing.recover((await bot.drafts.get(d.id))!, pending!.id, '987');
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
});
test('privacy/permissions are checked before publication and revoked access preserves the draft', async t => {
  const mock = telegramMock();
  t.mock.method(globalThis, 'fetch', (async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith('/getChat')) return Response.json({ ok: true, result: { id: -1001234567890, type: 'channel', username: 'public' } });
    return mock.fetch(...args);
  }) as typeof fetch);
  const bot = new Bot(env()); const d = await ready(bot);
  await assert.rejects(bot.publishing.save(d, 'original'), /private archive channel/);
  assert.equal(mock.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID && c.method === 'sendMessage'), false);
  assert.equal((await bot.drafts.get(d.id))?.status, 'preview_ready');
});
