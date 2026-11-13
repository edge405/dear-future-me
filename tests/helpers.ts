import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { Env } from '../src/config/env.ts';

// Executes the production SQL against SQLite; it does not duplicate repository behavior.
export function database(): D1Database & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  function prepare(sql: string) {
    let values: (string | number | null)[] = [];
    const result = {
      bind(...v: (string | number | null)[]) { values = v; return result; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } }; },
      async run() { const r = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return result;
  }
  return {
    sqlite, prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); sqlite.exec('COMMIT'); return result; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    }
  } as unknown as D1Database & { sqlite: DatabaseSync };
}
export function env(): Env {
  return { DB: database(), TELEGRAM_BOT_TOKEN: '123:testtoken', TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(40), OWNER_TELEGRAM_ID: '42', JOURNAL_CHANNEL_ID: '-1001234567890', AI_ENABLED: 'false' };
}
export const message = (id: number, text?: string) => ({ message_id: id, date: 1700000000 + id, chat: { id: 42, type: 'private' }, from: { id: 42 }, ...(text === undefined ? {} : { text }) });

export function telegramMock() {
  const calls: { method: string; body: Record<string, any> }[] = [];
  let nextId = 100;
  const mock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = String(input).split('/').at(-1)!;
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ method, body });
    let result: unknown = true;
    if (method === 'getMe') result = { id: 123 };
    if (method === 'getChatMemberCount') result = 2;
    if (method === 'getChat') result = { id: -1001234567890, type: 'channel' };
    if (method === 'getChatMember') result = body.user_id === 42 ? { status: 'creator' } : { status: 'administrator', can_post_messages: true };
    if (method === 'sendMessage' || method === 'copyMessage') result = { message_id: nextId++ };
    if (method === 'copyMessages') result = body.message_ids.map(() => ({ message_id: nextId++ }));
    return Response.json({ ok: true, result });
  };
  return { calls, fetch: mock as typeof fetch };
}
