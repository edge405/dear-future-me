import { client, main } from './common.ts';

await main(async () => {
  const tg = client();
  const info = await tg.call<{ url: string }>('getWebhookInfo');
  if (info.url) throw new Error('Refusing to poll while a webhook is active. Use the configured owner /id command or your existing setup records.');
  const updates = await tg.call<{ message?: { from?: { id: number }; chat: { id: number; type: string }; text?: string }; channel_post?: { chat: { id: number; type: string } }; my_chat_member?: { chat: { id: number; type: string } } }[]>(
    'getUpdates', { timeout: 0, allowed_updates: ['message','channel_post','my_chat_member'] });
  const ids = new Set<string>();
  for (const update of updates) {
    const message = update.message;
    if (message?.chat.type === 'private' && message.text === '/id' && message.from?.id === message.chat.id) ids.add(`Private account ID candidate: ${message.from.id}`);
    for (const channel of [update.channel_post?.chat, update.my_chat_member?.chat]) if (channel?.type === 'channel') ids.add(`Channel ID candidate: ${channel.id}`);
  }
  if (!ids.size) throw new Error('No setup IDs found. Send /id to your new bot, add it to your private channel as administrator, post a temporary channel message, then run this again.');
  for (const value of ids) console.log(value);
  console.log('Check these candidates belong to you and your channel. This script does not print message content, acknowledge updates, or change the webhook.');
});
