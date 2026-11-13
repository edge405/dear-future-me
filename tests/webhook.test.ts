import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { env, message, telegramMock } from './helpers.ts';
import { Bot } from '../src/telegram/commands.ts';
import type { Env } from '../src/config/env.ts';

function req(e: Env, update: unknown, secret = e.TELEGRAM_WEBHOOK_SECRET) {
  return new Request('https://test/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update) });
}
test('health reveals no secrets; invalid credentials, malformed and oversized requests are rejected', async () => {
  const e = env();
  assert.deepEqual(await (await worker.fetch(new Request('https://test/health'), e)).json(), { ok: true, service: 'life-journal' });
  assert.equal((await worker.fetch(req(e, {}, 'wrong'), e)).status, 403);
  assert.equal((await worker.fetch(req(e, { update_id: 'bad' }), e)).status, 400);
  assert.equal((await worker.fetch(req(e, { data: 'x'.repeat(270000) }), e)).status, 400);
  assert.equal((await worker.fetch(new Request('https://test/telegram/webhook'), e)).status, 405);
});
test('strangers, groups, channel posts, and forged callbacks touch no journal data', async t => {
  const e = env(); let touched = false;
  t.mock.method(e.DB, 'prepare', () => { touched = true; throw new Error('unauthorized_database_access'); });
  for (const u of [
    { update_id: 1, message: { ...message(1, '/history'), from: { id: 7 } } },
    { update_id: 2, message: { ...message(2, '/journal'), chat: { id: -42, type: 'group' } } },
    { update_id: 3, channel_post: { ...message(3, 'private channel text'), chat: { id: -1001, type: 'channel' } } },
    { update_id: 4, callback_query: { id: 'forged', from: { id: 7 }, message: message(4), data: 'j' } }
  ]) assert.equal((await worker.fetch(req(e, u), e)).status, 200);
  assert.equal(touched, false);
});
test('full original-only webhook workflow accepts notes and media, previews, approves, and confirms once', async t => {
  const e = env(); const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch); let id = 0;
  const send = async (text?: string, media?: Record<string, unknown>) => {
    id++; const update = { update_id: id, message: { ...message(id, text), ...media } };
    const response = await worker.fetch(req(e, update), e); assert.equal(response.status, 200); return update;
  };
  await send('/journal');
  await send('/save');
  assert.equal(mock.calls.some(c => c.body.chat_id === e.JOURNAL_CHANNEL_ID), false);
  const note = await send('A full day.'); await worker.fetch(req(e, note), e);
  await send('I learned something.');
  await send(undefined, { photo: [{}], caption: 'My photo' });
  await send(undefined, { voice: {} });
  await send('/done');
  assert.equal(mock.calls.some(c => c.body.chat_id === e.JOURNAL_CHANNEL_ID), false);
  const bot = new Bot(e); await bot.store.run('UPDATE journal_drafts SET last_content_at=0');
  await send('/save'); await send('/save');
  assert.equal((await bot.drafts.selected()).status, 'published');
  assert.equal(mock.calls.filter(c => c.method === 'copyMessages').length, 1);
  assert.deepEqual(mock.calls.find(c => c.method === 'copyMessages')?.body.message_ids, [3,4,5,6]);
  assert.match(mock.calls.at(-1)!.body.text, /Your journal is saved/);
  await send('/history'); assert.match(mock.calls.at(-1)!.body.text, /https:\/\/t.me\/c\//);
});
test('edits invalidate previews and old callback buttons cannot save changed content', async t => {
  const e = env(); const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(e); const d = await bot.drafts.start('2026-01-01'); await bot.drafts.append(message(1, 'old'), 1);
  const { draft } = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(draft);
  await worker.fetch(req(e, { update_id: 20, edited_message: message(1, 'edited exactly') }), e);
  assert.equal((await bot.drafts.get(d.id))?.status, 'collecting');
  assert.equal((await bot.drafts.messages(d.id))[0].original_text, 'edited exactly');
  await worker.fetch(req(e, { update_id: 21, callback_query: { id: 'cb', from: { id: 42 }, message: message(5), data: `s:${d.id}:${draft.revision}` } }), e);
  assert.match(mock.calls.at(-1)!.body.text, /draft changed/);
  assert.equal(mock.calls.some(c => c.body.chat_id === e.JOURNAL_CHANNEL_ID), false);
});
test('an invalid source edit blocks preparation until corrected, preserving existing content', async t => {
  const e = env(); const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(e); const d = await bot.drafts.start('2026-01-01'); await bot.drafts.append(message(1, 'original'), 1);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(p.draft);
  await assert.rejects(bot.drafts.edit(message(1)), /unsupported/);
  await assert.rejects(bot.entries.prepare((await bot.drafts.get(d.id))!), /edited original needs attention/);
  await assert.rejects(bot.publishing.save((await bot.drafts.get(d.id))!, 'original'), /read the preview/);
  assert.equal((await bot.drafts.messages(d.id))[0].original_text, 'original');
  await bot.drafts.edit(message(1, 'restored'));
  assert.equal((await bot.entries.prepare((await bot.drafts.get(d.id))!)).draft.preview_kind, 'original');
});
test('busy requests retry safely and terminal duplicate updates do not repeat replies', async t => {
  const e = env(); const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch); const bot = new Bot(e);
  await bot.store.locked(async () => {
    assert.equal((await worker.fetch(req(e, { update_id: 1, message: message(1, '/journal') }), e)).status, 503);
  });
  const update = { update_id: 1, message: message(1, '/journal') };
  assert.equal((await worker.fetch(req(e, update), e)).status, 200);
  const count = mock.calls.length;
  assert.equal((await worker.fetch(req(e, update), e)).status, 200); assert.equal(mock.calls.length, count);
});
