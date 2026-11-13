import { client, localConfig, main, required } from './common.ts';

await main(async () => {
  const config = localConfig();
  await client(config).verifyChannel(required(config, 'JOURNAL_CHANNEL_ID'), required(config, 'OWNER_TELEGRAM_ID'));
  console.log('Verified: private channel, owner is creator, bot can post, no more than two members, and no linked discussion chat. Manually revoke unused invite links and verify membership in Telegram.');
});
