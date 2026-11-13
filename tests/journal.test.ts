import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, message } from './helpers.ts';
import { Store } from '../src/database/queries.ts';
import { Drafts } from '../src/journal/drafts.ts';
import { canTransition } from '../src/journal/state-machine.ts';

test('starts, resumes, appends exact originals, deduplicates messages, and cancels', async () => {
  const s = new Store(database(), '42'); const d = new Drafts(s);
  const first = await d.start('2026-01-01');
  assert.equal((await d.start('2026-01-01')).id, first.id);
  await d.append(message(1, "I'm tired.\n  Exact spacing <&>"), 1);
  await d.append(message(2, 'Pero may natutunan ako.'), 2);
  await d.append(message(2, 'Pero may natutunan ako.'), 2);
  assert.equal((await d.messages(first.id)).length, 2);
  assert.equal((await d.messages(first.id))[0].original_text, "I'm tired.\n  Exact spacing <&>");
  await d.cancel(first.id);
  assert.equal((await d.get(first.id))?.status, 'cancelled');
  assert.equal((await d.messages(first.id)).length, 0);
  assert.notEqual((await d.start('2026-01-01')).id, first.id);
});
test('SQL constraints enforce transitions, rollback, and safe text parameterization', async () => {
  const db = database(); const s = new Store(db, '42'); const d = new Drafts(s); const draft = await d.start('2026-01-01');
  assert.equal(canTransition('collecting', 'publishing'), false);
  await assert.rejects(s.run("UPDATE journal_drafts SET status='published' WHERE id=?", draft.id), /invalid_draft_transition/);
  await d.append(message(1, "'); DROP TABLE journal_drafts; --"), 1);
  assert.equal((await d.messages(draft.id)).length, 1);
  await assert.rejects(db.batch([s.stmt("UPDATE journal_drafts SET title='bad' WHERE id=?", draft.id), s.stmt('INSERT INTO journal_drafts(id) VALUES (?)', 'broken')]));
  assert.equal((await d.get(draft.id))?.title, null);
  const plan = await s.all<{ detail: string }>('EXPLAIN QUERY PLAN SELECT * FROM journal_draft_messages WHERE draft_id=? ORDER BY telegram_message_id', draft.id);
  assert.match(plan.map(p => p.detail).join(' '), /messages_draft_order/);
});
test('update claims and owner locks prevent concurrent changes', async () => {
  const s = new Store(database(), '42');
  const token = await s.claim(1); assert.ok(token);
  await assert.rejects(s.claim(1), /update_busy/);
  await s.run("UPDATE processed_updates SET status='done' WHERE update_id=?", 1);
  assert.equal(await s.claim(1), null);
  await s.locked(async () => { await assert.rejects(s.locked(async () => {}), /owner_busy/); });
});
