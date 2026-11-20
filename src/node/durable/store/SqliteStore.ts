import {
  createSqliteBackend,
  type SqliteBackendConfig,
} from "./sql/sqliteBackend";
import { SqlDurableStore } from "./sql/SqlDurableStore";
import type { SqlStoreBaseConfig } from "./sql/types";

export type {
  SqliteDatabaseLike,
  SqliteStatementLike,
} from "../optionalDeps/sqlite";

/** Configuration options for {@link SqliteStore}. */
export interface SqliteStoreConfig
  extends SqlStoreBaseConfig, SqliteBackendConfig {}

/**
 * Durable store backed by Node's built-in `node:sqlite` (`DatabaseSync`).
 *
 * Suitable for single-node local persistence, CLI utilities, and embedded
 * services using WAL mode and serialized immediate write transactions.
 */
export class SqliteStore extends SqlDurableStore {
  /** Creates a new SQLite durable store (defaults to `":memory:"`). */
  constructor(config: SqliteStoreConfig = {}) {
    super(createSqliteBackend(config), config);
  }
}
