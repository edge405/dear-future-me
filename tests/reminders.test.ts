import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, telegramMock } from './helpers.ts';
import { Store } from '../src/database/queries.ts';
import { Telegram } from '../src/telegram/api.ts';
import { deliverReminder, scheduled } from '../src/reminders/scheduled.ts';
import { manilaDate, validEntryDate } from '../src/utils/dates.ts';

test('Philippine dates cross UTC midnight correctly and future dates are rejected', () => {
  assert.equal(manilaDate(new Date('2026-01-01T16:00:00Z')), '2026-01-02');
  assert.equal(manilaDate(new Date('2026-01-01T11:00:00Z')), '2026-01-01');
  assert.equal(validEntryDate('2026-02-30', '2026-03-01'), false);
  assert.equal(validEntryDate('2027-01-01', '2026-01-01'), false);
});
test('7 PM cron sends once per Manila date and does not need an incoming update', async t => {
  const time = Date.parse('2026-11-14T11:00:00Z'); t.mock.method(Date, 'now', () => time);
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch); const e = env();
  await scheduled(e, { cron: '0 11 * * *', scheduledTime: time });
  await scheduled(e, { cron: '0 11 * * *', scheduledTime: time });
  assert.equal(mock.calls.filter(c => c.method === 'sendMessage').length, 1);
  const delivery = await new Store(e.DB, '42').first<{ status: string; reminder_date: string }>('SELECT * FROM reminder_deliveries');
  assert.equal(delivery?.reminder_date, '2026-11-14'); assert.equal(delivery?.status, 'delivered');
});
test('definite reminder failure can retry; ambiguous delivery is never automatically resent', async t => {
  const e = env(); const s = new Store(e.DB, '42'); const tg = new Telegram(e.TELEGRAM_BOT_TOKEN); const mock = telegramMock();
  let fail = true;
  t.mock.method(globalThis, 'fetch', (async (...args: Parameters<typeof fetch>) => fail ? Response.json({ ok: false, error_code: 403 }, { status: 403 }) : mock.fetch(...args)) as typeof fetch);
  await deliverReminder(e, s, tg, Date.now());
  assert.equal((await s.first<{ status: string }>('SELECT status FROM reminder_deliveries'))?.status, 'failed');
  fail = false; await deliverReminder(e, s, tg, Date.now()); assert.equal(mock.calls.length, 1);
  await s.run('DELETE FROM reminder_deliveries');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout'); });
  await deliverReminder(e, s, tg, Date.now());
  assert.equal((await s.first<{ status: string }>('SELECT status FROM reminder_deliveries'))?.status, 'uncertain');
  const success = telegramMock(); t.mock.method(globalThis, 'fetch', success.fetch);
  await deliverReminder(e, s, tg, Date.now()); assert.equal(success.calls.length, 0);
});
test('saved days and wrong or stale cron invocations do not send reminders', async t => {
  const now = Date.parse('2026-11-14T11:00:00Z'); t.mock.method(Date, 'now', () => now);
  const e = env(); const s = new Store(e.DB, '42'); const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  await scheduled(e, { cron: '* * * * *', scheduledTime: now });
  await scheduled(e, { cron: '0 11 * * *', scheduledTime: now - 86400000 });
  assert.equal(mock.calls.length, 0);
  await s.run("INSERT INTO journal_drafts(id,telegram_user_id,entry_date,status,created_at,updated_at) VALUES ('d','42','2026-11-14','collecting',0,0)");
  await s.run("INSERT INTO journal_archives(id,draft_id,journal_date,title,channel_id,original_message_count,status,created_at) VALUES ('a','d','2026-11-14','day','-1001234567890',1,'published',0)");
  await scheduled(e, { cron: '0 11 * * *', scheduledTime: now }); assert.equal(mock.calls.length, 0);
});
