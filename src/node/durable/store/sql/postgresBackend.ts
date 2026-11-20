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
      pool = createPgPool(config.connectionString ?? config.poolConfig!);
    }
    return pool;
  };

  return {
    dialect: "postgres",
    async init(schemaStatements: readonly string[]): Promise<void> {
      const executor = createPgExecutor(ensurePool());
      for (const statement of schemaStatements) {
        await executor.run(statement);
      }
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
    async transaction<T>(
      operation: (tx: SqlExecutor) => Promise<T>,
    ): Promise<T> {
      const client = await ensurePool().connect();
      try {
        await client.query("BEGIN");
        const result = await operation(createPgExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async dispose(): Promise<void> {
      if (ownsPool && pool?.end) {
        await pool.end();
        pool = null;
      }
    },
  };
}
