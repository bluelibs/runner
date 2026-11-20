import { createRequire } from "node:module";
import { join } from "node:path";
import {
  optionalDependencyInvalidExportError,
  optionalDependencyMissingError,
} from "../../../errors";

/** Minimal structural contract for a synchronous prepared SQLite statement. */
export interface SqliteStatementLike {
  /** Executes a mutation statement and returns driver metadata. */
  run(...params: unknown[]): unknown;
  /** Returns the first matching row, or `undefined` when absent. */
  get(...params: unknown[]): unknown;
  /** Returns every matching row in order. */
  all(...params: unknown[]): unknown[];
}

/** Minimal structural contract compatible with Node's built-in `DatabaseSync`. */
export interface SqliteDatabaseLike {
  /** Executes one or more SQL statements without bound parameters. */
  exec(sql: string): void;
  /** Prepares a parameterized SQL statement for execution. */
  prepare(sql: string): SqliteStatementLike;
  /** Closes the database handle cleanly. */
  close(): void;
}

type SqliteConstructor = new (location: string) => SqliteDatabaseLike;

let cachedSqliteConstructor: SqliteConstructor | null = null;

function loadSqliteConstructor(): SqliteConstructor {
  if (cachedSqliteConstructor) return cachedSqliteConstructor;

  const requireFn = createRequire(join(process.cwd(), "__runner_require__.js"));
  let mod: unknown;
  try {
    mod = requireFn("node:sqlite") as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return optionalDependencyMissingError.throw({
      dependency: "node:sqlite",
      details: ` Node >= 22 with node:sqlite support is required (or pass a custom database instance). Original error: ${message}`,
    });
  }

  const candidate =
    typeof mod === "object" && mod !== null && "DatabaseSync" in mod
      ? (mod as { DatabaseSync: unknown }).DatabaseSync
      : null;
  if (typeof candidate !== "function") {
    return optionalDependencyInvalidExportError.throw({
      dependency: "node:sqlite",
      details: " Expected DatabaseSync constructor export.",
    });
  }
  cachedSqliteConstructor = candidate as SqliteConstructor;
  return cachedSqliteConstructor;
}

/** Opens a synchronous SQLite database handle using Node's built-in `node:sqlite`. */
export function openSqliteDatabase(location: string): SqliteDatabaseLike {
  const DatabaseSync = loadSqliteConstructor();
  return new DatabaseSync(location);
}
