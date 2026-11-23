import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Semaphore } from "../../../../models/Semaphore";
import {
  openSqliteDatabase,
  type SqliteDatabaseLike,
} from "../../optionalDeps/sqlite";
import type { SqlBackend, SqlExecutor, SqlParam, SqlRow } from "./types";

/** Configuration options for creating the SQLite backend adapter. */
export interface SqliteBackendConfig {
  /** Path to the SQLite database file, URI, or `":memory:"`. Defaults to `":memory:"`. */
  filename?: string;
  /** Existing synchronous SQLite database instance (caller retains lifecycle ownership). */
  database?: SqliteDatabaseLike;
  /** Busy timeout in milliseconds configured via `PRAGMA busy_timeout`. Defaults to `5000`. */
  busyTimeoutMs?: number;
}

const databasePermits = new WeakMap<SqliteDatabaseLike, Semaphore>();

function getDatabasePermit(database: SqliteDatabaseLike): Semaphore {
  const existing = databasePermits.get(database);
  if (existing) return existing;
  const permit = new Semaphore(1);
  databasePermits.set(database, permit);
  return permit;
}

function createSqliteExecutor(db: SqliteDatabaseLike): SqlExecutor {
  return {
    dialect: "sqlite",
    async all<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow[]> {
      return db.prepare(sql).all(...params) as TRow[];
    },
    async get<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow | null> {
      const row = db.prepare(sql).get(...params) as TRow | undefined;
      return row ?? null;
    },
    async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
      db.prepare(sql).run(...params);
    },
  };
}

/** Creates a WAL-enabled, transaction-serialized SQLite backend over `node:sqlite`. */
export function createSqliteBackend(
  config: SqliteBackendConfig = {},
): SqlBackend {
  const location = config.filename ?? ":memory:";
  const ownsDatabase = !config.database;
  const busyTimeoutMs = config.busyTimeoutMs ?? 5_000;
  // Transaction state belongs to the connection, even across namespaces.
  const txSemaphore = config.database
    ? getDatabasePermit(config.database)
    : new Semaphore(1);
  let db: SqliteDatabaseLike | null = config.database ?? null;
  let executor: SqlExecutor | null = db ? createSqliteExecutor(db) : null;

  const getExecutor = (): SqlExecutor => executor!;
  const getDb = (): SqliteDatabaseLike => db!;

  return {
    dialect: "sqlite",
    async init(schemaStatements: readonly string[]): Promise<void> {
      await txSemaphore.withPermit(async () => {
        if (!db) {
          if (location !== ":memory:" && !location.startsWith("file:")) {
            mkdirSync(dirname(location), { recursive: true });
          }
          db = openSqliteDatabase(location);
          executor = createSqliteExecutor(db);
        }
        db.exec(
          `PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))};`,
        );
        if (location !== ":memory:") {
          db.exec("PRAGMA journal_mode = WAL;");
          db.exec("PRAGMA synchronous = NORMAL;");
        }
        for (const statement of schemaStatements) {
          db.exec(statement);
        }
      });
    },
    async all<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow[]> {
      return txSemaphore.withPermit(() => getExecutor().all<TRow>(sql, params));
    },
    async get<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow | null> {
      return txSemaphore.withPermit(() => getExecutor().get<TRow>(sql, params));
    },
    async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
      await txSemaphore.withPermit(() => getExecutor().run(sql, params));
    },
    async transaction<T>(
      operation: (tx: SqlExecutor) => Promise<T>,
    ): Promise<T> {
      return txSemaphore.withPermit(async () => {
        const database = getDb();
        const tx = getExecutor();
        database.exec("BEGIN IMMEDIATE;");
        try {
          const result = await operation(tx);
          database.exec("COMMIT;");
          return result;
        } catch (error) {
          try {
            database.exec("ROLLBACK;");
          } catch {
            // Preserve the original failure if SQLite already rolled back the transaction.
          }
          throw error;
        }
      });
    },
    async dispose(): Promise<void> {
      await txSemaphore.withPermit(async () => {
        if (ownsDatabase && db) {
          db.close();
          db = null;
          executor = null;
        }
      });
    },
  };
}
