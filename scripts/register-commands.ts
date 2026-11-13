import { client, localConfig, main, required } from './common.ts';
import { botCommands } from '../src/telegram/menu.ts';

await main(async () => {
  const config = localConfig(); const tg = client(config);
  const chat_id = Number(required(config, 'OWNER_TELEGRAM_ID'));
  const scope = { type: 'chat', chat_id };
  await tg.call('setMyCommands', { scope, commands: botCommands });
  await tg.call('setChatMenuButton', { chat_id, menu_button: { type: 'commands' } });
  const actual = await tg.call<{ command: string }[]>('getMyCommands', { scope });
  if (actual.map(c => c.command).join(',') !== botCommands.map(c => c.command).join(',')) throw new Error('Verification failed: command menu does not match.');
  console.log(`Verified ${actual.length} commands in the owner's Telegram menu. No webhook or journal changes.`);
});
