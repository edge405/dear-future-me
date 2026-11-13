import type { Env } from '../config/env.ts';
import { systemInstruction } from './prompts.ts';
import { responseSchema, validateAi, MAX_AI_STORY_LENGTH } from './validation.ts';
import type { AiEntry } from './validation.ts';
import { validEntryDate, manilaDate } from '../utils/dates.ts';

// Explicit allowlist from official pricing/model docs reviewed 2026-11-14.
// Adding a model requires a fresh pricing/capability review. No automatic aliases/fallback.
export const reviewedFreeModels = ['gemini-3.5-flash-lite'] as const;
export function aiConfigured(env: Env, now = Date.now()): boolean {
  const expires = env.GEMINI_FREE_TIER_VERIFIED_UNTIL ?? '';
  const expiry = Date.parse(expires + 'T23:59:59+08:00');
  return env.AI_ENABLED === 'true' && !!env.GEMINI_API_KEY &&
    reviewedFreeModels.some(m => m === env.GEMINI_MODEL) && validEntryDate(expires, '9999-12-31') &&
    expires >= manilaDate(now) && expiry - now <= 31 * 86400000;
}

export async function verifyModel(env: Env): Promise<void> {
  if (!aiConfigured(env)) throw new Error('ai_configuration_unverified');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}`, {
    // Workers supports manual/follow, not error. Manual plus the status check prevents redirects.
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY! }, signal: AbortSignal.timeout(8000), redirect: 'manual'
  });
  if (!response.ok) throw new Error(`ai_http_${response.status}`);
  const model = await response.json() as { name?: string; supportedGenerationMethods?: string[] };
  if (model.name !== `models/${env.GEMINI_MODEL}` || !model.supportedGenerationMethods?.includes('generateContent'))
    throw new Error('ai_model_unsupported');
}

export async function generate(env: Env, consent: boolean, date: string, notes: string[], revision?: string, previousStory?: string): Promise<AiEntry> {
  if (!consent) throw new Error('ai_consent_required');
  if (!aiConfigured(env)) throw new Error('ai_configuration_unverified');
  if (notes.join('').length > 24000 || (revision?.length ?? 0) > 800 || (previousStory?.length ?? 0) > MAX_AI_STORY_LENGTH) throw new Error('ai_input_limit');
  await verifyModel(env);
  // No media URLs/file IDs, no grounding, caching, tools, or billed fallback models.
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ entry_date: date, notes, revision_request: revision ?? '', previous_story: revision ? previousStory ?? '' : '' }) }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: responseSchema, maxOutputTokens: 12000, temperature: 0.1 }
    })
  });
  if (!response.ok) throw new Error(`ai_http_${response.status}`);
  const data = await response.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new Error('ai_incomplete_output');
  const text = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('');
  if (!text || text.length > 70000) throw new Error('invalid_ai_output');
  return validateAi(JSON.parse(text), date);
}

export function aiFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ai_http_429') return 'Gemini reached its free quota. Your original entry is ready to save.';
  if (code === 'ai_http_402') return 'Gemini requires billing for this request. Your original entry is ready to save.';
  if (/ai_http_(400|401|403|404)/.test(code)) return 'Gemini is unavailable for this key or model. Check setup; your original entry is ready to save.';
  if (code === 'ai_input_limit') return 'This entry is too long for the configured AI limit. Your original entry is ready to save.';
  return 'Gemini could not prepare a valid entry. Your original entry is ready to save.';
}
