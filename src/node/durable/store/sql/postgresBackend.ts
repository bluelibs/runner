import { durableExecutionInvariantError } from "../../../../errors";
import { createPgPool, type PgPoolLike } from "../../optionalDeps/pg";
import type { SqlBackend, SqlExecutor, SqlParam, SqlRow } from "./types";

/** Configuration options for creating the PostgreSQL backend adapter. */
export interface PostgresBackendConfig {
  /** Pre-configured `pg.Pool` (or structural equivalent). Caller retains lifecycle ownership. */
  pool?: PgPoolLike;
  /** PostgreSQL connection URI (passed directly to `pg.Pool` when `pool` is omitted). */
  connectionString?: string;
  /** Raw `pg.PoolConfig` object used to construct an owned pool when `pool` is omitted. */
  poolConfig?: Record<string, unknown>;
}

/** Rewrites positional `?` placeholders to PostgreSQL `$1..$N`, skipping single-quoted literals. */
export function rewritePgPlaceholders(sql: string): string {
  let out = "";
  let index = 0;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (ch === "?" && !inSingleQuote) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }

  return out;
}

function createPgExecutor(queryable: Pick<PgPoolLike, "query">): SqlExecutor {
  const all = async <TRow extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<TRow[]> => {
    const result = await queryable.query<TRow>(rewritePgPlaceholders(sql), [
      ...params,
    ]);
    return result.rows;
  };
  return {
    dialect: "postgres",
    all,
    async get<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow | null> {
      const rows = await all<TRow>(sql, params);
      return rows[0] ?? null;
    },
    async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
      await queryable.query(rewritePgPlaceholders(sql), [...params]);
    },
  };
}

function extractDdlObjectName(statement: string): string | null {
  const match =
    /^\s*CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/i.exec(
      statement,
    );
  return match ? match[1].toLowerCase() : null;
}

/** Creates a transactional PostgreSQL backend over `pg.Pool` or a custom pool adapter. */
export function createPostgresBackend(
  config: PostgresBackendConfig,
): SqlBackend {
  if (!config.pool && !config.connectionString && !config.poolConfig) {
    return durableExecutionInvariantError.throw({
      message:
        "PostgresStore requires `pool`, `connectionString`, or `poolConfig`.",
    });
  }

  const ownsPool = !config.pool;
  let pool: PgPoolLike | null = config.pool ?? null;
  const ensurePool = (): PgPoolLike => {
    if (!pool) {
      const poolInput =
        config.connectionString && config.poolConfig
          ? { ...config.poolConfig, connectionString: config.connectionString }
          : (config.connectionString ?? config.poolConfig!);
      pool = createPgPool(poolInput);
      // Prevent unhandled `'error'` crashes when an idle pooled client drops on failover/restart.
      pool.on?.("error", () => undefined);
    }
    return pool;
  };

  async function transaction<T>(
    operation: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const client = await ensurePool().connect();
    let destroyClient = false;
    try {
      try {
        await client.query("BEGIN");
      } catch (beginError) {
        destroyClient = true;
        throw beginError;
      }
      const result = await operation(createPgExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (!destroyClient) {
        await client.query("ROLLBACK").catch(() => {
          destroyClient = true;
        });
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }

  return {
    dialect: "postgres",
    async init(schemaStatements: readonly string[]): Promise<void> {
      const ddlObjects = schemaStatements.map(extractDdlObjectName);
      let pendingStatements: readonly string[] = schemaStatements;
      if (ddlObjects.every((name) => name !== null)) {
        const existingRows = await createPgExecutor(ensurePool()).all<{
          name: string;
        }>(
          `SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()
           UNION ALL
           SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()`,
        );
        const existing = new Set(
          existingRows.map((row) => String(row.name).toLowerCase()),
        );
        // Skip CREATE TABLE/INDEX IF NOT EXISTS when already present so worker boots
        // do not acquire table-wide ShareLocks on existing production indexes.
        pendingStatements = schemaStatements.filter(
          (_statement, idx) => !existing.has(ddlObjects[idx]!),
        );
        if (pendingStatements.length === 0) return;
      }
      await transaction(async (tx) => {
        // Concurrent IF NOT EXISTS DDL can still collide in the system catalogs.
        await tx.run("SELECT pg_advisory_xact_lock(?, ?)", [0x72756e6e, 1]);
        for (const statement of pendingStatements) await tx.run(statement);
      });
    },
    async all<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow[]> {
      return createPgExecutor(ensurePool()).all<TRow>(sql, params);
    },
    async get<TRow extends SqlRow = SqlRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ): Promise<TRow | null> {
      return createPgExecutor(ensurePool()).get<TRow>(sql, params);
    },
    async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
      await createPgExecutor(ensurePool()).run(sql, params);
    },
    transaction,
    async dispose(): Promise<void> {
      if (ownsPool && pool?.end) {
        await pool.end();
        pool = null;
      }
    },
  };
}
