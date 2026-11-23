import {
  createPostgresBackend,
  type PostgresBackendConfig,
} from "./sql/postgresBackend";
import { SqlDurableStore } from "./sql/SqlDurableStore";
import type { SqlStoreBaseConfig } from "./sql/types";

export type {
  PgClientLike,
  PgPoolLike,
  PgQueryResultLike,
} from "../optionalDeps/pg";

/** Configuration options for {@link PostgresStore}. */
export interface PostgresStoreConfig
  extends SqlStoreBaseConfig, PostgresBackendConfig {}

/**
 * Durable store backed by PostgreSQL (`pg.Pool` or any compatible pool adapter).
 *
 * Supports multi-worker concurrency via row-level `FOR UPDATE` locking,
 * `FOR UPDATE SKIP LOCKED` timer claiming, and namespace-scoped schemas.
 */
export class PostgresStore extends SqlDurableStore {
  /** PostgreSQL stores can be shared concurrently across multiple worker processes. */
  readonly isSharedAcrossProcesses = true;

  /** Creates a new PostgreSQL durable store backed by `pool`, `connectionString`, or `poolConfig`. */
  constructor(config: PostgresStoreConfig) {
    super(createPostgresBackend(config), config);
  }
}
