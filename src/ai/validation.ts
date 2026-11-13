export type JournalLanguage = 'english' | 'tagalog' | 'taglish' | 'other';
export interface AiEntry { language: JournalLanguage; title: string; entry_date: string; story: string }
export const MAX_AI_STORY_LENGTH = 32000;
const languages: JournalLanguage[] = ['english', 'tagalog', 'taglish', 'other'];
const lineOrControl = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/u;

function singleLine(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && value === value.trim() &&
    /[\p{L}\p{N}]/u.test(value) && !lineOrControl.test(value);
}

// Old previews must be refreshed before a new AI publication. Keep legacy columns
// and already-frozen publication plans so interrupted saves remain recoverable.
export function currentAiPreview(d: { title: string | null; ai_preview: string | null; ai_reflection: string | null; ai_question: string | null }): boolean {
  return singleLine(d.title, 160) && singleLine(d.ai_preview, MAX_AI_STORY_LENGTH) && !d.ai_reflection && !d.ai_question;
}

export const responseSchema = {
  type: 'object', additionalProperties: false, properties: {
    language: { type: 'string', enum: languages, description: 'Infer from all original notes, independent of the revision-request language.' },
    title: { type: 'string', description: 'One meaningful factual title, one line, in the original language and voice.' },
    entry_date: { type: 'string', description: 'Exact date supplied by the application.' },
    story: { type: 'string', description: 'One continuous first-person paragraph, no newlines or separate commentary; preserve important details and original language.' }
  }, required: ['language','title','entry_date','story']
};
export function validateAi(value: unknown, date: string): AiEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_ai_output');
  const v = value as Record<string, unknown>;
  const fields = ['language','title','entry_date','story'];
  if (Object.keys(v).some(k => !fields.includes(k)) || !languages.includes(v.language as JournalLanguage) ||
      !singleLine(v.title, 160) || !singleLine(v.story, MAX_AI_STORY_LENGTH)) throw new Error('invalid_ai_output');
  if (v.entry_date !== date) throw new Error('invalid_ai_date');
  return v as unknown as AiEntry;
}
