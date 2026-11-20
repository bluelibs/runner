import type { Serializer } from "../../../../serializer";

/** Supported SQL dialects for the shared durable SQL store. */
export type SqlDialect = "sqlite" | "postgres";

/** Primitive parameter values accepted uniformly by SQLite and PostgreSQL backends. */
export type SqlParam = string | number | null;

/** Generic SQL result row with column names mapped to unknown values. */
export type SqlRow = Record<string, unknown>;

/** Shared query/execute surface implemented by SQL backends and transaction handles. */
export interface SqlExecutor {
  /** Dialect handled by this executor. */
  readonly dialect: SqlDialect;
  /** Executes a statement that returns rows (e.g. `SELECT`). */
  all<TRow extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<TRow[]>;
  /** Executes a statement returning at most one row, or `null` when missing. */
  get<TRow extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<TRow | null>;
  /** Executes a mutation statement (`INSERT`, `UPDATE`, `DELETE`, DDL). */
  run(sql: string, params?: readonly SqlParam[]): Promise<void>;
}

/** Dialect adapter responsible for connections, DDL, transactions, and disposal. */
export interface SqlBackend extends SqlExecutor {
  /** Initializes connections and applies idempotent schema DDL. */
  init(schemaStatements: readonly string[]): Promise<void>;
  /** Runs `operation` inside an ACID transaction. */
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Releases connections/handles owned by this backend. */
  dispose(): Promise<void>;
}

/** Common durable store options shared by SQL adapters. */
export interface SqlStoreBaseConfig {
  /**
   * Logical isolation namespace stored in every table's primary key so
   * multiple isolated durable stores can share a single database cleanly.
   * Defaults to `"default"`.
   */
  namespace?: string;
  /** Optional serializer instance (defaults to Runner's `new Serializer()`). */
  serializer?: Serializer;
  /** Automatically initialize tables on first query if `init()` was not called yet. Defaults to `true`. */
  autoCreateTables?: boolean;
}

/** Returns ` FOR UPDATE` for PostgreSQL row-level locking, empty string for SQLite. */
export function forUpdate(dialect: SqlDialect): string {
  return dialect === "postgres" ? " FOR UPDATE" : "";
}
