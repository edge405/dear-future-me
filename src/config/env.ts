export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  JOURNAL_CHANNEL_ID: string;
  AI_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FREE_TIER_VERIFIED_UNTIL?: string;
}

export function validateEnv(env: Env): void {
  if (!/^[1-9]\d*$/.test(env.OWNER_TELEGRAM_ID) || !Number.isSafeInteger(Number(env.OWNER_TELEGRAM_ID)))
    throw new Error('owner_configuration');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN)) throw new Error('bot_configuration');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) throw new Error('secret_configuration');
  if (!/^-100\d+$/.test(env.JOURNAL_CHANNEL_ID)) throw new Error('channel_configuration');
}
