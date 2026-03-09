import fs from "fs";
import path from "path";

import Database from "better-sqlite3";
import { r } from "@bluelibs/runner";

import { appConfig } from "../config/app-config.resource";

export const sqlite = r
  .resource("sqlite")
  .dependencies({ appConfig })
  .init(async (_, { appConfig }): Promise<Database.Database> => {
    fs.mkdirSync(path.dirname(appConfig.sqlitePath), { recursive: true });
    const db = new Database(appConfig.sqlitePath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_budget_state (
        day TEXT PRIMARY KEY,
        spent_usd REAL NOT NULL,
        request_count INTEGER NOT NULL,
        stopped INTEGER NOT NULL,
        stop_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS ip_rate_limits (
        day TEXT NOT NULL,
        minute_bucket TEXT NOT NULL,
        ip TEXT NOT NULL,
        request_count INTEGER NOT NULL,
        PRIMARY KEY (day, minute_bucket, ip)
      );
      CREATE TABLE IF NOT EXISTS query_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        day TEXT NOT NULL,
        ip TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        actual_cost_usd REAL NOT NULL,
        status TEXT NOT NULL
      );
    `);
    return db;
  })
  .dispose(async (db) => {
    db.close();
  })
  .build();
