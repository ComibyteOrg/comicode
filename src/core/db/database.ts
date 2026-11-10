import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

/**
 * Resolve `node:sqlite` through the runtime module table. Bundlers do not know
 * this newer builtin and can rewrite a static import to the bare name
 * "sqlite" (which npm does not provide), so a runtime lookup keeps the
 * `node:` prefix intact across esbuild/tsup versions.
 */
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
const DatabaseSync = sqlite.DatabaseSync;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class Db {
  readonly raw: NodeDatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL;');
      this.raw.exec('PRAGMA synchronous = NORMAL;');
    }
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(SCHEMA_SQL);
    const current = this.metaGet('schema_version');
    if (!current) {
      this.metaSet('schema_version', String(SCHEMA_VERSION));
    }
  }

  metaGet(key: string): string | null {
    const row = this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  metaSet(key: string, value: string): void {
    this.run(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    const statement = this.raw.prepare(sql);
    return statement.all(...(params as never[])) as T[];
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    const statement = this.raw.prepare(sql);
    return statement.get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): RunResult {
    const statement = this.raw.prepare(sql);
    const result = statement.run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.raw.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }
      throw error;
    }
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      // Already closed.
    }
  }
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
