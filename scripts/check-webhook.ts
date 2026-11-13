import { client, main } from './common.ts';

await main(async () => {
  const info = await client().call<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string; max_connections?: number; allowed_updates?: string[] }>('getWebhookInfo');
  console.log(JSON.stringify({ registered: !!info.url, pending_updates: info.pending_update_count,
    last_error_at: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    delivery_error_present: !!info.last_error_message, max_connections: info.max_connections, allowed_updates: info.allowed_updates }, null, 2));
  // Intentionally omit the remote error string and URL: they can contain sensitive setup data.
  if (!info.url || info.last_error_message) process.exitCode = 1;
});
