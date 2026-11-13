import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwner } from '../src/security/authorization.ts';
import { parseUpdate, secretMatches } from '../src/security/webhook-validation.ts';

const u = { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, from: { id: 42 } } };
test('accepts the owner and rejects strangers, groups, and forged callbacks', () => {
  assert.equal(isOwner(u, '42'), true);
  assert.equal(isOwner(u, '7'), false);
  assert.equal(isOwner({ ...u, message: { ...u.message, chat: { id: 42, type: 'group' } } }, '42'), false);
  assert.equal(isOwner({ update_id: 2, callback_query: { id: 'c', from: { id: 7 }, message: u.message } }, '42'), false);
});
test('validates webhook secret and update structure', () => {
  assert.equal(secretMatches('abc', 'abc'), true);
  assert.equal(secretMatches(null, 'abc'), false);
  assert.equal(secretMatches('abd', 'abc'), false);
  assert.equal(parseUpdate(u)?.update_id, 1);
  assert.equal(parseUpdate({ ...u, update_id: '1' }), null);
  assert.equal(parseUpdate({ ...u, message: {} }), null);
});
