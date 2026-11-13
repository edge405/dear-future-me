import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Telegram } from '../src/telegram/api.ts';
import { chunks, channelLink } from '../src/telegram/formatting.ts';
import { telegramMock, env } from './helpers.ts';
import { reviewedFreeModels } from '../src/ai/gemini.ts';

test('Worker uses only D1, one cron, and no paid service bindings or runtime dependencies', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, ['0 11 * * *']);
  const example = readFileSync(new URL('../.dev.vars.example', import.meta.url), 'utf8');
  assert.match(example, /^AI_ENABLED="false"$/m);
  assert.ok(['false', 'true'].includes(config.vars.AI_ENABLED));
  if (config.vars.AI_ENABLED === 'true') {
    assert.ok(reviewedFreeModels.includes(config.vars.GEMINI_MODEL));
    assert.match(config.vars.GEMINI_FREE_TIER_VERIFIED_UNTIL, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(config.workers_dev, true);
  assert.equal(pkg.dependencies, undefined);
  for (const binding of ['r2_buckets','queues','durable_objects','ai','vectorize','services','hyperdrive','kv_namespaces']) assert.equal(binding in config, false);
});
test('paid broadcasts are blocked and plain text chunks preserve Unicode and content', async t => {
  const mock = telegramMock(); t.mock.method(globalThis, 'fetch', mock.fetch);
  await assert.rejects(new Telegram('123:test').call('sendMessage', { allow_paid_broadcast: true }), /paid_features_forbidden/);
  assert.equal(mock.calls.length, 0);
  const text = '<&> ' + '😌'.repeat(3000); const parts = chunks(text);
  assert.equal(parts.join(''), text); assert.ok(parts.every(p => p.length <= 3800));
  assert.ok(parts.every(p => !/[\uD800-\uDBFF]$/.test(p)));
  assert.equal(channelLink(env().JOURNAL_CHANNEL_ID, 123), 'https://t.me/c/1234567890/123');
});
