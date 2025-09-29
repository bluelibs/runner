import { globals, r } from "@bluelibs/runner";
import sqlite3 from "sqlite3";

export interface DatabaseConfig {
  filename?: string;
  verbose?: boolean;
}

export interface Database {
  db: sqlite3.Database;
  run: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;
  get: <T = any>(sql: string, params?: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  close: () => Promise<void>;
}

export const db = r
  .resource<DatabaseConfig>("app.resources.database")
  .dependencies({ logger: globals.resources.logger })
  .init(async (config, { logger }): Promise<Database> => {
    const { filename = ":memory:", verbose = false } = config;

    const db = new sqlite3.Database(filename, (err) => {
      if (err) {
        logger.error("Error opening database:", err);
        throw err;
      }
      if (verbose) {
        logger.info(`Connected to SQLite database: ${filename}`);
      }
    });

    if (verbose) {
      db.on("trace", (sql) => logger.debug(`SQL: ${sql}`));
    }

    // Promisify database methods
    const run = (sql: string, params?: any[]): Promise<sqlite3.RunResult> => {
      return new Promise((resolve, reject) => {
        db.run(sql, params || [], function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    };

    const get = <T = any>(
      sql: string,
      params?: any[],
    ): Promise<T | undefined> => {
      return new Promise((resolve, reject) => {
        db.get(sql, params || [], (err, row) => {
          if (err) reject(err);
          else resolve(row as T);
        });
      });
    };

    const all = <T = any>(sql: string, params?: any[]): Promise<T[]> => {
      return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows as T[]);
        });
      });
    };

    const close = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
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
