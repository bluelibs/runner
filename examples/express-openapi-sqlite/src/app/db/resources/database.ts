import { globals, r } from "@bluelibs/runner";
import BetterSqlite3, {
  type Database as BetterSqlite3Database,
} from "better-sqlite3";

export interface DatabaseConfig {
  filename?: string;
  verbose?: boolean;
}

export interface RunResult {
  lastID: number | bigint;
  changes: number;
}

export interface Database {
  db: BetterSqlite3Database;
  run: (sql: string, params?: any[]) => Promise<RunResult>;
  get: <T = any>(sql: string, params?: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  close: () => Promise<void>;
}

export const db = r
  .resource<DatabaseConfig>("app.resources.database")
  .dependencies({ logger: globals.resources.logger })
  .init(async (config, { logger }): Promise<Database> => {
    const { filename = ":memory:", verbose = false } = config;

    const db = new BetterSqlite3(filename);

    if (verbose) {
      logger.info(`Connected to SQLite database: ${filename}`);
    }

    const logQuery = (sql: string, params?: any[]) => {
      if (!verbose) return;
      logger.debug(`SQL: ${sql} | params: ${JSON.stringify(params ?? [])}`);
    };

    const get = <T = any>(
      sql: string,
      params?: any[],
    ): Promise<T | undefined> => {
      logQuery(sql, params);
      const row = db.prepare(sql).get(...(params ?? []));
      return Promise.resolve(row as T | undefined);
    };

    const all = <T = any>(sql: string, params?: any[]): Promise<T[]> => {
      logQuery(sql, params);
      const rows = db.prepare(sql).all(...(params ?? []));
      return Promise.resolve(rows as T[]);
    };

    const run = (sql: string, params?: any[]): Promise<RunResult> => {
      logQuery(sql, params);
      const result = db.prepare(sql).run(...(params ?? []));
      return Promise.resolve({
        lastID: result.lastInsertRowid,
        changes: result.changes,
      });
    };

    const close = (): Promise<void> => {
      db.close();
      return Promise.resolve();
    };

    // Initialize schema
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    return {
      db,
      run,
      get,
      all,
      close,
    };
  })
  .dispose(async (database, _, { logger }) => {
    await database.close();
    logger.info("Database connection closed");
  })
  .build();
