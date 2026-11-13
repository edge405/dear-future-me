import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, message, telegramMock } from './helpers.ts';
import { aiConfigured, generate } from '../src/ai/gemini.ts';
import { validateAi } from '../src/ai/validation.ts';
import { manilaDate } from '../src/utils/dates.ts';
import { Bot } from '../src/telegram/commands.ts';
import { callback } from '../src/telegram/callbacks.ts';

const output = { language: 'english', title: 'A quiet walk', entry_date: '2026-01-01', story: 'I walked today.' };
function aiEnv() { return { ...env(), AI_ENABLED: 'true', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'test', GEMINI_FREE_TIER_VERIFIED_UNTIL: manilaDate(Date.now() + 86400000) }; }
function aiMock(status = 200, value: unknown = output) {
  const telegram = telegramMock(); const bodies: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input).includes('api.telegram.org')) return telegram.fetch(input, init);
    if (!init?.body) return Response.json({ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] });
    bodies.push(String(init.body));
    return status === 200 ? Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) : Response.json({ error: {} }, { status });
  };
  return { fetch: fetcher as typeof fetch, bodies, telegram };
}
test('AI requires configuration, fresh verification, an allowed model, and explicit consent', async t => {
  const m = aiMock(); t.mock.method(globalThis, 'fetch', m.fetch);
  assert.equal(aiConfigured(env()), false);
  assert.equal(aiConfigured(aiEnv()), true);
  assert.equal(aiConfigured({ ...aiEnv(), GEMINI_MODEL: 'paid-only' }), false);
  assert.equal(aiConfigured({ ...aiEnv(), GEMINI_FREE_TIER_VERIFIED_UNTIL: '2020-01-01' }), false);
  await assert.rejects(generate(aiEnv(), false, output.entry_date, ['private']), /consent_required/);
  assert.equal(m.bodies.length, 0);
  const bot = new Bot(aiEnv()); const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'I walked today.'), 1);
  await bot.entries.prepare((await bot.drafts.get(d.id))!);
  assert.equal(m.bodies.length, 0);
  await bot.command(message(2, '/ai_on'), 2);
  const nonce = (await bot.store.settings()).consent_nonce!;
  assert.ok(nonce);
  await callback(bot, { id: 'cb', from: { id: 42 }, message: message(3), data: 'a:' + nonce });
  assert.equal((await bot.store.settings()).ai_consent, 1);
  await bot.disableAi();
  await assert.rejects(callback(bot, { id: 'cb', from: { id: 42 }, message: message(3), data: 'a:' + nonce }), /expired/);
});
test('structured generation succeeds, preserves state date, and sends text/captions only', async t => {
  const m = aiMock(); t.mock.method(globalThis, 'fetch', m.fetch);
  const result = await generate(aiEnv(), true, output.entry_date, ['I walked today.', 'A photo caption.']);
  assert.deepEqual(result, output);
  const body = JSON.parse(m.bodies[0]);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
  assert.match(body.systemInstruction.parts[0].text, /untrusted data/);
  assert.equal('tools' in body, false);
  assert.equal('inlineData' in body.contents[0].parts[0], false);
  assert.throws(() => validateAi({ ...output, entry_date: '2030-01-01' }, output.entry_date), /invalid_ai_date/);
  assert.throws(() => validateAi({ ...output, story: 5 }, output.entry_date), /invalid_ai_output/);
});
test('rate limits, invalid JSON structure, timeout, and invalid keys preserve original-save fallback', async t => {
  for (const scenario of ['429', '401', '402', 'invalid', 'timeout']) {
    const m = aiMock(/^\d+$/.test(scenario) ? Number(scenario) : 200, scenario === 'invalid' ? { bad: true } : output);
    const base = m.fetch;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      if (scenario === 'timeout' && String(input).includes(':generateContent')) throw new Error('network');
      return base(input, init);
    };
    const mock = t.mock.method(globalThis, 'fetch', fetcher as typeof fetch);
    const bot = new Bot(aiEnv()); await bot.store.settings(); await bot.store.run('UPDATE app_settings SET ai_consent=1');
    const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'I walked today.'), 1);
    const prepared = await bot.entries.prepare((await bot.drafts.get(d.id))!);
    assert.equal(prepared.draft.preview_kind, 'original'); assert.ok(prepared.warning);
    if (scenario === '402') assert.equal((await bot.store.settings()).ai_consent, 0);
    assert.equal((await bot.drafts.messages(d.id))[0].original_text, 'I walked today.');
    await bot.entries.preview(prepared.draft); await bot.store.run('UPDATE journal_drafts SET last_content_at=0');
    assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
    mock.mock.restore();
  }
});
test('generation attempts are limited per draft without blocking originals', async t => {
  const m = aiMock(); t.mock.method(globalThis, 'fetch', m.fetch);
  const bot = new Bot(aiEnv()); await bot.store.settings(); await bot.store.run('UPDATE app_settings SET ai_consent=1');
  const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'I walked today.'), 1);
  for (let i = 0; i < 4; i++) await bot.entries.prepare((await bot.drafts.get(d.id))!, true);
  assert.equal(m.bodies.length, 3);
  assert.equal((await bot.drafts.get(d.id))?.preview_kind, 'original');
});
test('Gemini uses Worker-compatible manual redirects and never follows a redirected API key request', async t => {
  const calls: { url: string; redirect: RequestInit['redirect']; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect, body: init?.body });
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } });
  }) as typeof fetch);
  await assert.rejects(generate(aiEnv(), true, output.entry_date, ['Synthetic private note']), /ai_http_302/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].body, undefined);
  assert.ok(calls.every(c => c.url.startsWith('https://generativelanguage.googleapis.com/')));
});
