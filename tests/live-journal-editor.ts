import assert from 'node:assert/strict';
import { localConfig } from '../scripts/common.ts';
import type { Env } from '../src/config/env.ts';
import { aiConfigured, generate } from '../src/ai/gemini.ts';
import { manilaDate } from '../src/utils/dates.ts';
import { languageFixtures } from './fixtures/journal-languages.ts';
import type { AiEntry } from '../src/ai/validation.ts';

// Explicit opt-in only: at most three sequential live generations; no retries,
// personal journal reads, D1 writes, or Telegram publication. Existing consent is untouched.
const config = localConfig() as unknown as Env;
if (!aiConfigured(config)) throw new Error('AI setup must already have a current Free-tier verification before this synthetic check.');
const results: { language: string; passed: boolean; errorCode?: string }[] = [];
const selected = process.argv.slice(2);
if (selected.some(name => !languageFixtures.some(f => f.name === name))) throw new Error('Select English, Tagalog, or Taglish for a focused synthetic check.');
for (const fixture of languageFixtures.filter(f => !selected.length || selected.includes(f.name))) {
  let entry: AiEntry | undefined;
  try {
    entry = await generate(config, true, manilaDate(), fixture.notes, fixture.revision);
    assert.equal(entry.language, fixture.language);
    for (const fact of fixture.facts) assert.match(entry.story, fact);
    for (const inference of fixture.disallowedInferences) assert.doesNotMatch(entry.title + '\n' + entry.story, inference);
    assert.doesNotMatch(entry.story, /everything happens for a reason|every challenge is|laban lang|kaya ko ang lahat/iu);
    console.log(JSON.stringify({ syntheticLanguageCheck: fixture.name, passed: true, detectedLanguage: entry.language,
      sourceFactsMatched: true, title: entry.title, story: entry.story, englishRevisionRequest: Boolean(fixture.revision) }));
    results.push({ language: fixture.name, passed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const errorCode = /^(?:ai_[a-z0-9_]+|invalid_ai_[a-z_]+)$/.test(message) ? message : error instanceof assert.AssertionError ? 'language_or_fixture_check_failed' : 'network_or_response_error';
    results.push({ language: fixture.name, passed: false, errorCode });
    console.log(JSON.stringify({ syntheticLanguageCheck: fixture.name, passed: false, errorCode,
      ...(entry ? { detectedLanguage: entry.language, title: entry.title, story: entry.story,
        missingFactPatterns: fixture.facts.filter(pattern => !pattern.test(entry!.story)).map(String),
        disallowedInferencesMatched: fixture.disallowedInferences.filter(pattern => pattern.test(entry!.title + '\n' + entry!.story)).map(String) } : {}) }));
  }
}
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
  model: config.GEMINI_MODEL, personalJournalTextSent: false, telegramMessagesSent: false }));
if (results.some(r => !r.passed)) process.exitCode = 1;
