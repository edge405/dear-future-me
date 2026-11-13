import { client, localConfig, main, question, required } from './common.ts';
import { validateEnv } from '../src/config/env.ts';
import type { Env } from '../src/config/env.ts';
import { botCommands } from '../src/telegram/menu.ts';

await main(async () => {
  const config = localConfig(); validateEnv(config as unknown as Env);
  const url = new URL(process.argv[2] ?? await question('Deployed HTTPS workers.dev base URL: '));
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.port || url.search || url.hash || !['','/'].includes(url.pathname))
    throw new Error('Use the HTTPS base URL of your deployed workers.dev Worker without a path or credentials.');
  const health = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!health.ok || (await health.json() as { service?: string }).service !== 'life-journal') throw new Error('Worker health verification failed. Deploy and check configuration first.');
  const tg = client(config);
  await tg.verifyChannel(required(config, 'JOURNAL_CHANNEL_ID'), required(config, 'OWNER_TELEGRAM_ID'));
  const endpoint = new URL('/telegram/webhook', url).href;
  await tg.call('setWebhook', { url: endpoint, secret_token: required(config, 'TELEGRAM_WEBHOOK_SECRET'),
    allowed_updates: ['message','edited_message','callback_query','channel_post','my_chat_member'], max_connections: 1, drop_pending_updates: false });
  await tg.call('setMyCommands', { scope: { type: 'chat', chat_id: Number(config.OWNER_TELEGRAM_ID) }, commands: botCommands });
  const info = await tg.call<{ url: string; max_connections: number; pending_update_count: number }>('getWebhookInfo');
  if (info.url !== endpoint || info.max_connections !== 1) throw new Error('Verification failed: Telegram webhook settings do not match.');
  console.log(`Webhook registered and verified. Pending updates: ${info.pending_update_count}. Send /start to your bot. No pending updates were discarded.`);
});
