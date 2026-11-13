import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Telegram } from '../src/telegram/api.ts';

export function localConfig(): Record<string, string> {
  let file = '';
  try { file = readFileSync(resolve('.dev.vars'), 'utf8'); } catch { /* Environment variables also supported. */ }
  const values: Record<string, string> = {};
  for (const line of file.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) throw new Error('Invalid .dev.vars syntax. Use KEY="value", one per line.');
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[m[1]] = value;
  }
  for (const key of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','OWNER_TELEGRAM_ID','JOURNAL_CHANNEL_ID','GEMINI_API_KEY','GEMINI_MODEL','GEMINI_FREE_TIER_VERIFIED_UNTIL','AI_ENABLED']) {
    if (process.env[key] !== undefined) values[key] = process.env[key]!;
  }
  return values;
}
export function required(config: Record<string, string>, name: string): string {
  const value = config[name];
  if (!value || /REPLACE/.test(value)) throw new Error(`Set ${name} in the ignored .dev.vars file first.`);
  return value;
}
export function client(config = localConfig()): Telegram { return new Telegram(required(config, 'TELEGRAM_BOT_TOKEN')); }
export async function question(text: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run this script interactively in a terminal.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(text)).trim(); } finally { rl.close(); }
}
export async function main(fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    // Only our own fixed errors and Telegram numeric codes are surfaced. No stack/URLs/remote bodies.
    const { TelegramError } = await import('../src/utils/errors.ts');
    if (e instanceof TelegramError) console.error(`Telegram request failed (code ${e.code || 'network/timeout'}). Check configuration and connectivity.`);
    else if (e instanceof Error && (e.name === 'UserError' || /^Set |^Invalid |^Run |^No |^Use |^Check |^Refusing |^Could |^AI |^Worker |^Verification |^Missing |^Wrangler /.test(e.message))) console.error(e.message);
    else console.error('Setup could not finish. Check credentials, connectivity, and the setup guide. No secret values were printed.');
    process.exitCode = 1;
  }
}
