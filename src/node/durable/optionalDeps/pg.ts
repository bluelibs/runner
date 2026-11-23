import { createRequire } from "node:module";
import { join } from "node:path";
import {
  optionalDependencyInvalidExportError,
  optionalDependencyMissingError,
} from "../../../errors";

/** Minimal query result shape compatible with `pg` clients and pools. */
export interface PgQueryResultLike<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Rows returned by the query. */
  rows: TRow[];
}

/** Minimal checked-out client contract compatible with `pg.PoolClient`. */
export interface PgClientLike {
  /** Executes a parameterized SQL statement against the checked-out connection. */
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResultLike<TRow>>;
  /** Returns the client back to the pool. */
  release(err?: boolean | Error): void;
}

/** Minimal PostgreSQL pool contract compatible with `pg.Pool`. */
export interface PgPoolLike {
  /** Executes a single parameterized SQL query using an available pooled connection. */
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResultLike<TRow>>;
  /** Acquires a dedicated connection for transactional execution. */
  connect(): Promise<PgClientLike>;
  /** Closes every connection in the pool when owned by the store. */
  end?(): Promise<void>;
  /** Registers an event listener (e.g. `"error"` on idle pool clients). */
  on?(event: "error", listener: (error: Error) => void): unknown;
}

type PgPoolConstructor = new (config?: Record<string, unknown>) => PgPoolLike;

let cachedPgPoolConstructor: PgPoolConstructor | null = null;

function extractPgPoolConstructor(mod: unknown): unknown {
  if (typeof mod !== "object" || mod === null) return null;
  if ("Pool" in mod && typeof (mod as { Pool: unknown }).Pool === "function") {
    return (mod as { Pool: unknown }).Pool;
  }
  if (
    "default" in mod &&
    typeof (mod as { default: unknown }).default === "object" &&
    (mod as { default: unknown }).default !== null &&
    "Pool" in (mod as { default: { Pool?: unknown } }).default
  ) {
    return (mod as { default: { Pool: unknown } }).default.Pool;
  }
  return null;
}

function loadPgPoolConstructor(): PgPoolConstructor {
  if (cachedPgPoolConstructor) return cachedPgPoolConstructor;

  const requireFn = createRequire(join(process.cwd(), "__runner_require__.js"));
  let mod: unknown;
  try {
    mod = requireFn("pg") as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return optionalDependencyMissingError.throw({
      dependency: "pg",
      details: ` Install it or pass an explicit pg pool instance. Original error: ${message}`,
    });
  }

  const candidate = extractPgPoolConstructor(mod);
  if (typeof candidate !== "function") {
    return optionalDependencyInvalidExportError.throw({
      dependency: "pg",
      details: " Expected pg.Pool constructor export.",
    });
  }
  cachedPgPoolConstructor = candidate as PgPoolConstructor;
  return cachedPgPoolConstructor;
}

/** Creates a `pg.Pool` instance from connection options or a connection string. */
export function createPgPool(
  config: string | Record<string, unknown>,
): PgPoolLike {
  const Pool = loadPgPoolConstructor();
  return typeof config === "string"
    ? new Pool({ connectionString: config })
    : new Pool(config);
}
