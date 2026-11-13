import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, message, telegramMock } from './helpers.ts';
import { Bot } from '../src/telegram/commands.ts';
import { copyBatches, messageType } from '../src/telegram/media.ts';
import type { DraftMessage } from '../src/database/types.ts';

test('accepts media types, preserves captions, and rejects unsupported or protected media', async () => {
  const bot = new Bot(env()); const d = await bot.drafts.start('2026-01-01');
  for (const [i, type] of ['photo','video','voice','audio','document'].entries()) {
    const m = { ...message(i + 1), [type]: type === 'photo' ? [{}] : {}, caption: '  Original caption 😌' };
    assert.equal(messageType(m), type); await bot.drafts.append(m, i + 1);
  }
  assert.equal((await bot.drafts.messages(d.id))[0].original_caption, '  Original caption 😌');
  assert.equal(messageType(message(99)), null);
  await assert.rejects(bot.drafts.append({ ...message(98), photo: [{}], has_protected_content: true }, 98), /cannot archive/);
});
test('batches at 100, keeps albums together across boundaries, and sorts IDs', () => {
  const list = Array.from({ length: 110 }, (_, i) => ({ telegram_message_id: i + 1, media_group_id: i >= 95 && i < 105 ? 'album' : null })) as DraftMessage[];
  const batches = copyBatches(list.reverse());
  assert.deepEqual(batches.map(b => b.length), [95,15]);
  assert.deepEqual(batches.flat(), Array.from({ length: 110 }, (_, i) => i + 1));
});
test('late album items invalidate a preview; partial batch copies can map completed sources and retry only missing items', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = new Bot(env()); const d = await bot.drafts.start('2026-01-01');
  await bot.drafts.append({ ...message(2), photo: [{}], media_group_id: 'album', caption: 'photo two' }, 2);
  await bot.entries.prepare((await bot.drafts.get(d.id))!);
  await bot.drafts.append({ ...message(1), photo: [{}], media_group_id: 'album' }, 1);
  assert.equal((await bot.drafts.get(d.id))?.status, 'collecting');
  const { draft } = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(draft);
  await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  const call = bot.tg.call.bind(bot.tg);
  t.mock.method(bot.tg, 'call', async (method: string, body?: Record<string, unknown>) => method === 'copyMessages' ? [{ message_id: 800 }] : call(method, body));
  await assert.rejects(bot.publishing.save((await bot.drafts.get(d.id))!, 'original'), /uncertain result/);
  const item = (await bot.store.first<{ id: number; source_message_ids: string }>("SELECT * FROM archive_items WHERE copy_status='uncertain'"))!;
  assert.equal(item.source_message_ids, '[1,2]');
  await bot.publishing.recover((await bot.drafts.get(d.id))!, item.id, 'map:1=800');
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
  assert.equal(mock.calls.find(c => c.method === 'copyMessage')?.body.message_id, 2);
  assert.equal(mock.calls.some(c => 'caption' in c.body || c.body.remove_caption), false);
});
