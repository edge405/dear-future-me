import { localConfig, main, question, required } from './common.ts';
import { generate, reviewedFreeModels } from '../src/ai/gemini.ts';
import { manilaDate } from '../src/utils/dates.ts';
import type { Env } from '../src/config/env.ts';

await main(async () => {
  const config = localConfig(); required(config, 'GEMINI_API_KEY'); required(config, 'GEMINI_MODEL');
  if (!reviewedFreeModels.some(m => m === config.GEMINI_MODEL)) throw new Error('AI model has not been reviewed for free-tier text/structured generation in this release.');
  console.log('First check Google AI Studio: this key belongs to your intended project, the project is on the Free tier, billing is NOT linked/enabled, and this exact model has free text input/output quota in your region. Check the current official pricing and deprecation pages. This API cannot verify project billing status. Gemini Plus provides no API entitlement.');
  if (await question('Type FREE_ONLY after checking all of the above (otherwise press Enter to stop): ') !== 'FREE_ONLY')
    throw new Error('AI verification stopped. Leave AI disabled.');
  const expiry = manilaDate(Date.now() + 30 * 86400000);
  await generate({ ...config, AI_ENABLED: 'true', GEMINI_FREE_TIER_VERIFIED_UNTIL: expiry } as unknown as Env, true,
    manilaDate(), ['This is a synthetic setup test. I tested my journal application today.']);
  console.log(`Synthetic text and structured-output probe passed for ${config.GEMINI_MODEL}. Set GEMINI_FREE_TIER_VERIFIED_UNTIL="${expiry}" and AI_ENABLED="true" in wrangler.jsonc and local .dev.vars, then deploy. This records your billing attestation; it is not independent proof of free-project eligibility. In Telegram, /ai_on still requires separate consent for personal text.`);
});
