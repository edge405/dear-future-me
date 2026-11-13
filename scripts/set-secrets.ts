import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { localConfig, main, required } from './common.ts';
import { validateEnv } from '../src/config/env.ts';
import type { Env } from '../src/config/env.ts';

await main(async () => {
  const config = localConfig();
  if (!config.TELEGRAM_WEBHOOK_SECRET || /REPLACE/.test(config.TELEGRAM_WEBHOOK_SECRET)) {
    const file = resolve('.dev.vars');
    const original = readFileSync(file, 'utf8');
    config.TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString('base64url');
    const line = `TELEGRAM_WEBHOOK_SECRET="${config.TELEGRAM_WEBHOOK_SECRET}"`;
    writeFileSync(file, /^TELEGRAM_WEBHOOK_SECRET=.*$/m.test(original) ? original.replace(/^TELEGRAM_WEBHOOK_SECRET=.*$/m, line) : original + '\n' + line + '\n');
    console.log('Generated a webhook secret in the ignored .dev.vars file.');
  }
  for (const key of ['TELEGRAM_BOT_TOKEN','OWNER_TELEGRAM_ID','JOURNAL_CHANNEL_ID']) required(config, key);
  validateEnv(config as unknown as Env);
  const keys = ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','OWNER_TELEGRAM_ID','JOURNAL_CHANNEL_ID'];
  if (config.GEMINI_API_KEY) keys.push('GEMINI_API_KEY');
  for (const key of keys) {
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', key], {
        shell: false, windowsHide: true, stdio: ['pipe','inherit','inherit']
      });
      child.on('error', reject); child.on('close', done); child.stdin.end(config[key]);
    });
    if (code !== 0) throw new Error(`Wrangler could not store ${key}. Complete Cloudflare login and retry.`);
  }
  console.log('Secrets stored using stdin. They were not placed in command arguments. Redeploy if Wrangler created your Worker during setup.');
});
