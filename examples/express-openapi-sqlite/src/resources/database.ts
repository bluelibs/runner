import { resource } from "@bluelibs/runner";
import sqlite3 from "sqlite3";
import { User } from "../types";

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

export const databaseResource = resource<DatabaseConfig, Promise<Database>>({
  id: "app.resources.database",
  init: async (config: DatabaseConfig): Promise<Database> => {
    const { filename = ':memory:', verbose = false } = config;
    
    const db = new sqlite3.Database(filename, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        throw err;
      }
      if (verbose) {
        console.log('Connected to SQLite database:', filename);
      }
    });

    if (verbose) {
      db.on('trace', (sql) => console.log('SQL:', sql));
    }

    // Promisify database methods
    const run = (sql: string, params?: any[]): Promise<sqlite3.RunResult> => {
      return new Promise((resolve, reject) => {
        db.run(sql, params || [], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    };

    const get = <T = any>(sql: string, params?: any[]): Promise<T | undefined> => {
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
      close
    };
  },
  dispose: async (database: Database) => {
    await database.close();
    console.log('Database connection closed');
  }
});