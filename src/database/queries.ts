import type { Settings } from './types.ts';
import { BusyError } from '../utils/errors.ts';

export class Store {
  db: D1Database;
  owner: string;
  constructor(db: D1Database, owner: string) { this.db = db; this.owner = owner; }
  stmt(sql: string, ...values: (string | number | null)[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...values);
  }
  async run(sql: string, ...values: (string | number | null)[]): Promise<number> {
    const r = await this.stmt(sql, ...values).run();
    return r.meta.changes;
  }
  first<T>(sql: string, ...values: (string | number | null)[]): Promise<T | null> {
    return this.stmt(sql, ...values).first<T>();
  }
  async all<T>(sql: string, ...values: (string | number | null)[]): Promise<T[]> {
    return (await this.stmt(sql, ...values).all<T>()).results;
  }
  async settings(): Promise<Settings> {
    await this.run('INSERT OR IGNORE INTO app_settings(owner_id, updated_at) VALUES (?, ?)', this.owner, Date.now());
    return (await this.first<Settings>('SELECT * FROM app_settings WHERE owner_id = ?', this.owner))!;
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    const token = crypto.randomUUID();
    const now = Date.now();
    const acquired = await this.run(`INSERT INTO owner_locks(owner_id, token, lease_until) VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET token=excluded.token, lease_until=excluded.lease_until
      WHERE owner_locks.lease_until < ?`, this.owner, token, now + 180000, now);
    if (!acquired) throw new BusyError('owner_busy');
    try { return await fn(); }
    finally { await this.run('DELETE FROM owner_locks WHERE owner_id = ? AND token = ?', this.owner, token); }
  }
  async claim(update: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const now = Date.now();
    const changes = await this.run(`INSERT INTO processed_updates(update_id,status,token,lease_until,processed_at)
      VALUES (?, 'processing', ?, ?, ?) ON CONFLICT(update_id) DO UPDATE SET
      token=excluded.token, lease_until=excluded.lease_until, processed_at=excluded.processed_at
      WHERE processed_updates.status='processing' AND processed_updates.lease_until < ?`, update, token, now + 180000, now, now);
    if (changes) return token;
    const row = await this.first<{ status: string }>('SELECT status FROM processed_updates WHERE update_id = ?', update);
    if (row?.status === 'done') return null;
    throw new BusyError('update_busy');
  }
}
