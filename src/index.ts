import type { Env } from './config/env.ts';
import { validateEnv } from './config/env.ts';
import { webhook } from './telegram/webhook.ts';
import { scheduled } from './reminders/scheduled.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ ok: true, service: 'life-journal' }, { headers: { 'cache-control': 'no-store' } });
    if (path !== '/telegram/webhook') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
    try { validateEnv(env); } catch { return new Response('Service needs configuration.', { status: 503 }); }
    return webhook(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    validateEnv(env);
    try { await scheduled(env, controller); }
    catch { console.warn(JSON.stringify({ event: 'reminder_unavailable' })); }
  }
} satisfies ExportedHandler<Env>;
