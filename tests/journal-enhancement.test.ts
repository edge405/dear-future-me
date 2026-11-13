import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, message, telegramMock } from './helpers.ts';
import { languageFixtures } from './fixtures/journal-languages.ts';
import type { AiEntry } from '../src/ai/validation.ts';
import { validateAi, currentAiPreview } from '../src/ai/validation.ts';
import { Bot } from '../src/telegram/commands.ts';
import { callback } from '../src/telegram/callbacks.ts';
import { cb } from '../src/journal/entries.ts';
import { journalHeading, chunks } from '../src/telegram/formatting.ts';
import { Telegram } from '../src/telegram/api.ts';
import { manilaDate } from '../src/utils/dates.ts';
import { TelegramError } from '../src/utils/errors.ts';

function modelMock(outputs: AiEntry[]) {
  const telegram = telegramMock(); const requests: Record<string, any>[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input).includes('api.telegram.org')) return telegram.fetch(input, init);
    if (!init?.body) return Response.json({ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] });
    const body = JSON.parse(String(init.body)); requests.push(body);
    const output = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });
  };
  return { telegram, requests, fetch: fetcher as typeof fetch };
}

async function aiBot() {
  const bot = new Bot({ ...env(), AI_ENABLED: 'true', GEMINI_API_KEY: 'test', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_FREE_TIER_VERIFIED_UNTIL: manilaDate(Date.now() + 86400000) });
  await bot.store.settings(); await bot.store.run('UPDATE app_settings SET ai_consent=1');
  return bot;
}

for (const fixture of languageFixtures) {
  test(`${fixture.name}: all notes reach the editor in source order and one faithful paragraph is previewed before approval`, async t => {
    const mock = modelMock([fixture.edited]); t.mock.method(globalThis, 'fetch', mock.fetch);
    const bot = await aiBot(); const original = await bot.drafts.start('2026-01-01');
    // Delivery order differs from private-chat sequence; editing must still see chronological notes.
    for (const i of [2,0,1]) await bot.drafts.append(message(i + 1, fixture.notes[i]), i + 1);
    const prepared = await bot.entries.prepare((await bot.drafts.get(original.id))!);
    const input = JSON.parse(mock.requests[0].contents[0].parts[0].text);
    assert.deepEqual(input.notes, fixture.notes);
    assert.equal('language' in input, false); // No language picker or caller-selected target language.
    assert.match(mock.requests[0].systemInstruction.parts[0].text, /Automatically infer the language from ALL original notes/);
    assert.match(mock.requests[0].systemInstruction.parts[0].text, /English revision request must not turn Tagalog or Taglish/);
    assert.equal(prepared.draft.ai_preview, fixture.edited.story);
    assert.equal(prepared.draft.ai_reflection, null); assert.equal(prepared.draft.ai_question, null);
    assert.ok(currentAiPreview(prepared.draft));
    for (const fact of fixture.facts) assert.match(prepared.draft.ai_preview!, fact);
    for (const inference of fixture.disallowedInferences) assert.doesNotMatch(prepared.draft.title + '\n' + prepared.draft.ai_preview, inference);
    assert.deepEqual((await bot.drafts.messages(original.id)).map(m => m.original_text), fixture.notes);
    assert.equal(mock.telegram.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID), false);
    await assert.rejects(bot.publishing.save(prepared.draft, 'ai'), /read the preview/);
    await bot.entries.preview(prepared.draft);
    const preview = mock.telegram.calls.at(-1)!.body;
    assert.match(preview.text, /AI-edited preview/);
    assert.equal(preview.text.split(fixture.edited.title).length - 1, 1);
    assert.equal(preview.text.includes('AI reflection'), false); assert.equal(preview.text.includes('Optional question'), false);
    const titleEntity = preview.entities[0];
    assert.equal(preview.text.slice(titleEntity.offset, titleEntity.offset + titleEntity.length), fixture.edited.title);
    const actions = preview.reply_markup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data.split(':')[0]);
    for (const action of ['s','o','g','v']) assert.ok(actions.includes(action));
    assert.equal(mock.telegram.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID), false);
  });
}

test('structured validation rejects extra commentary, multiple titles/paragraphs, control separators, and wrong dates', () => {
  const valid = languageFixtures[0].edited;
  assert.deepEqual(validateAi(valid, valid.entry_date), valid);
  for (const separator of ['\n','\r\n','\n\n','\u0085','\u2028','\u2029']) {
    assert.throws(() => validateAi({ ...valid, story: 'I worked.' + separator + 'I went home.' }, valid.entry_date), /invalid_ai_output/);
    assert.throws(() => validateAi({ ...valid, title: 'Work' + separator + 'Home' }, valid.entry_date), /invalid_ai_output/);
  }
  for (const value of [{ ...valid, reflection: 'A lesson.' }, { ...valid, question: 'What next?' }, { ...valid, summary: 'Summary' }, { ...valid, title: '' }, { ...valid, story: '   ' }, { ...valid, language: 'translate-to-english' }, { ...valid, story: 'a'.repeat(32001) }])
    assert.throws(() => validateAi(value, valid.entry_date), /invalid_ai_output/);
  assert.throws(() => validateAi({ ...valid, entry_date: '2030-01-01' }, valid.entry_date), /invalid_ai_date/);
  assert.doesNotThrow(() => validateAi({ ...valid, story: 'I wrote a detailed diary. '.repeat(900).trim() }, valid.entry_date));
});

test('AI-approved text/photo/video entry has one bold title, one paragraph, then untouched original copies', async t => {
  const output = { ...languageFixtures[2].edited, title: 'Pagod 😌 & <Report>' };
  const mock = modelMock([output]); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = await aiBot(); const d = await bot.drafts.start(output.entry_date);
  for (const [i, note] of languageFixtures[2].notes.entries()) await bot.drafts.append(message(i + 1, note), i + 1);
  await bot.drafts.append({ ...message(4), photo: [{}], caption: '  Original photo caption <&>  ' }, 4);
  await bot.drafts.append({ ...message(5), video: { file_id: 'never-send-video-file-id-to-ai' }, caption: 'My exact video caption.' }, 5);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(p.draft);
  const input = JSON.parse(mock.requests[0].contents[0].parts[0].text);
  assert.deepEqual(input.notes, [...languageFixtures[2].notes, '  Original photo caption <&>  ', 'My exact video caption.']);
  assert.equal(JSON.stringify(mock.requests).includes('never-send-video-file-id-to-ai'), false);
  await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'ai')).done, true);
  const sends = mock.telegram.calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].body.entities, journalHeading(output.entry_date, output.title).entities);
  assert.equal(sends[0].body.text, journalHeading(output.entry_date, output.title).text);
  assert.equal(sends[1].body.text, output.story);
  assert.equal(sends.some(c => c.body.parse_mode), false);
  assert.deepEqual(mock.telegram.calls.find(c => c.method === 'copyMessages')?.body.message_ids, [1,2,3,4,5]);
  assert.equal(mock.telegram.calls.some(c => 'caption' in c.body || c.body.remove_caption), false);
  assert.equal((await bot.store.first<{ n: number }>("SELECT COUNT(*) AS n FROM archive_items WHERE item_type='reflection'"))?.n, 0);
});

test('revision uses previous wording plus unchanged originals; regeneration and stale approval remain safe', async t => {
  const fixture = languageFixtures[2];
  const revised = { ...fixture.edited, story: fixture.edited.story.replace('Super pagod', 'Pagod na pagod') };
  const mock = modelMock([fixture.edited, revised, fixture.edited]); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = await aiBot(); const d = await bot.drafts.start(fixture.edited.entry_date);
  for (const [i, note] of fixture.notes.entries()) await bot.drafts.append(message(i + 1, note), i + 1);
  const first = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(first.draft);
  const revision = 'Improve the transitions while keeping my Taglish voice and all details.';
  await bot.prepare((await bot.drafts.get(d.id))!, true, revision);
  const request = JSON.parse(mock.requests[1].contents[0].parts[0].text);
  assert.deepEqual(request.notes, fixture.notes); assert.equal(request.previous_story, fixture.edited.story); assert.equal(request.revision_request, revision);
  await assert.rejects(callback(bot, { id: 'old', from: { id: 42 }, message: message(10), data: cb('s', first.draft) }), /draft changed/);
  const latest = (await bot.drafts.get(d.id))!;
  await callback(bot, { id: 'regenerate', from: { id: 42 }, message: message(11), data: cb('g', latest) });
  assert.equal(mock.requests.length, 3);
  assert.equal(JSON.parse(mock.requests[2].contents[0].parts[0].text).previous_story, '');
  assert.equal(mock.telegram.calls.some(c => c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID), false);
  const ready = (await bot.drafts.get(d.id))!; await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  await callback(bot, { id: 'save-original', from: { id: 42 }, message: message(12), data: cb('o', ready) });
  assert.equal((await bot.drafts.get(d.id))?.approved_kind, 'original');
  const channelText = mock.telegram.calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID).map(c => c.body.text).join('\n');
  assert.ok(channelText.includes(fixture.notes.join('\n\n')));
});

test('invalid multi-paragraph AI response offers original fallback without deleting notes/media', async t => {
  const fixture = languageFixtures[0]; const mock = modelMock([{ ...fixture.edited, story: 'I worked.\n\nI went home.' }]);
  t.mock.method(globalThis, 'fetch', mock.fetch); const bot = await aiBot(); const d = await bot.drafts.start(fixture.edited.entry_date);
  await bot.drafts.append(message(1, fixture.notes[0]), 1); await bot.drafts.append({ ...message(2), photo: [{}], caption: 'Exact caption' }, 2);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!);
  assert.equal(p.draft.preview_kind, 'original'); assert.ok(p.warning);
  assert.equal((await bot.drafts.messages(d.id))[0].original_text, fixture.notes[0]);
  await bot.entries.preview(p.draft); await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
  assert.deepEqual(mock.telegram.calls.find(c => c.method === 'copyMessages')?.body.message_ids, [1,2]);
});

test('old unpublished AI previews require fresh generation; original-only saving remains available', async t => {
  const output = languageFixtures[0].edited; const mock = modelMock([output]); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = await aiBot(); const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'Original note'), 1);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(p.draft);
  await bot.store.run("UPDATE journal_drafts SET ai_preview=?,ai_reflection=?,ai_question=? WHERE id=?", 'Old first paragraph.\n\nOld second paragraph.', 'Legacy reflection', 'Legacy question?', d.id);
  const old = (await bot.drafts.get(d.id))!;
  await assert.rejects(bot.entries.preview(old), /previous format/);
  await assert.rejects(bot.publishing.save(old, 'ai'), /previous format/);
  const fresh = await bot.entries.prepare(old);
  assert.ok(fresh.draft.revision > old.revision); assert.ok(currentAiPreview(fresh.draft));
  assert.equal((await bot.drafts.messages(d.id))[0].original_text, 'Original note');
  await bot.entries.preview(fresh.draft); await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'original')).done, true);
});

test('resuming a frozen legacy publication preserves its approved heading and completed operations', async t => {
  const output = languageFixtures[0].edited; const mock = modelMock([output]); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = await aiBot(); const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'Original note'), 1);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(p.draft);
  await bot.store.run('UPDATE journal_drafts SET last_content_at=0 WHERE id=?', d.id);
  const call = bot.tg.call.bind(bot.tg); let fail = true;
  t.mock.method(bot.tg, 'call', async (method: string, body?: Record<string, unknown>) => {
    if (method === 'sendMessage' && body?.chat_id === bot.env.JOURNAL_CHANNEL_ID && fail) { fail = false; throw new TelegramError(429, false, 0); }
    return call(method, body);
  });
  await assert.rejects(bot.publishing.save((await bot.drafts.get(d.id))!, 'ai'), /Saving paused/);
  const legacyHeading = '📖 January 1, 2026\nOld approved title\n\nApproved AI-assisted story follows.';
  await bot.store.run("UPDATE archive_items SET payload=? WHERE archive_id=? AND item_type='heading'", legacyHeading, d.id);
  await bot.store.run('UPDATE journal_drafts SET ai_reflection=? WHERE id=?', 'Old approved reflection', d.id);
  assert.equal((await bot.publishing.save((await bot.drafts.get(d.id))!, 'ai')).done, true);
  const heading = mock.telegram.calls.find(c => c.method === 'sendMessage' && c.body.chat_id === bot.env.JOURNAL_CHANNEL_ID)!.body;
  assert.equal(heading.text, legacyHeading); assert.equal(heading.entities, undefined);
});

test('long previews require the final page and Unicode title entities remain valid across chunks', async t => {
  const output = { ...languageFixtures[0].edited, story: 'I worked on the report today. '.repeat(170).trim() };
  const mock = modelMock([output]); t.mock.method(globalThis, 'fetch', mock.fetch);
  const bot = await aiBot(); const d = await bot.drafts.start(output.entry_date); await bot.drafts.append(message(1, 'Long notes'), 1);
  const p = await bot.entries.prepare((await bot.drafts.get(d.id))!); await bot.entries.preview(p.draft);
  await assert.rejects(bot.publishing.save((await bot.drafts.get(d.id))!, 'ai'), /read the preview/);
  const next = mock.telegram.calls.at(-1)!.body.reply_markup.inline_keyboard.flat().find((b: { text: string }) => b.text === 'Next preview');
  assert.ok(next);
  await callback(bot, { id: 'next', from: { id: 42 }, message: message(3), data: next.callback_data });
  assert.equal((await bot.drafts.get(d.id))?.preview_seen_revision, p.draft.revision);
  const title = 'Report 😌 & <Home>'; const text = 'x'.repeat(3795) + title + ' end'; const start = 3795;
  await new Telegram('123:test').send('42', text, undefined, [{ type: 'bold', offset: start, length: title.length }]);
  const fragments = mock.telegram.calls.slice(-chunks(text).length).map(c => c.body);
  assert.equal(fragments.map(p => p.text).join(''), text);
  assert.equal(fragments.flatMap(p => p.entities ?? []).reduce((n, e) => n + e.length, 0), title.length);
});
