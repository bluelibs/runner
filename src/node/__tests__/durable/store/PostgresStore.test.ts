import { DatabaseSync } from "node:sqlite";
import {
  PostgresStore,
  type PgPoolLike,
} from "../../../durable/store/PostgresStore";
import { registerSqlExecContractTests } from "./sqlStoreContract.exec.helpers";
import { registerSqlViewsContractTests } from "./sqlStoreContract.viewsRetention.helpers";
import { registerSqlRetentionContractTests } from "./sqlStoreContract.retention.helpers";
import { registerSqlSignalContractTests } from "./sqlStoreContract.signals.helpers";
import { registerSqlTimersAndCommandsContractTests } from "./sqlStoreContract.timersCommands.helpers";

function createSqliteBackedPgPool(): {
  pool: PgPoolLike;
  close: () => void;
} {
  const db = new DatabaseSync(":memory:");

  const adaptSqlAndParams = (
    text: string,
    values: unknown[] = [],
  ): { sql: string; params: Array<string | number | null> } => {
    const params: Array<string | number | null> = [];
    let sql = "";
    let inSingleQuote = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "'") {
        sql += ch;
        if (inSingleQuote && text[i + 1] === "'") {
          sql += "'";
          i += 1;
        } else {
          inSingleQuote = !inSingleQuote;
        }
        continue;
      }
      if (ch === "$" && !inSingleQuote) {
        const match = /^\$(\d+)/.exec(text.slice(i));
        if (match) {
          const idx = Number(match[1]) - 1;
          const val = values[idx];
          params.push(
            val === undefined ? null : (val as string | number | null),
          );
          sql += "?";
          i += match[0].length - 1;
          continue;
        }
      }
      sql += ch;
    }

    sql = sql
      .replace(/ COLLATE "C"/g, "")
      .replace(/ FOR UPDATE OF t SKIP LOCKED/g, "")
      .replace(/ FOR UPDATE/g, "")
      .replace(
        /id BIGSERIAL PRIMARY KEY/g,
        "id INTEGER PRIMARY KEY AUTOINCREMENT",
      )
      .replace(
        /ORDER BY id ASC OFFSET \?/g,
        "ORDER BY id ASC LIMIT -1 OFFSET ?",
      );

    return { sql, params };
  };

  const runQuery = <TRow extends Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): { rows: TRow[] } => {
    const upper = text.trim().toUpperCase();
    if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") {
      db.exec(`${upper};`);
      return { rows: [] };
    }
    const { sql, params } = adaptSqlAndParams(text, values);
    if (upper.startsWith("SELECT")) {
      return { rows: db.prepare(sql).all(...params) as TRow[] };
    }
    db.prepare(sql).run(...params);
    return { rows: [] };
  };

  const pool: PgPoolLike = {
    async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      return runQuery<TRow>(text, values);
    },
    async connect() {
      return {
        async query<
          TRow extends Record<string, unknown> = Record<string, unknown>,
        >(text: string, values?: unknown[]) {
          return runQuery<TRow>(text, values);
        },
        release() {},
      };
    },
  };

  return { pool, close: () => db.close() };
}

describe("durable: PostgresStore (SQLite-backed PgPool adapter)", () => {
  const handles: Array<() => void> = [];

  afterAll(() => {
    for (const close of handles) close();
  });

  const factory = {
    createStore: async (config?: {
      namespace?: string;
      autoCreateTables?: boolean;
    }) => {
      const adapter = createSqliteBackedPgPool();
      handles.push(adapter.close);
      return new PostgresStore({ pool: adapter.pool, ...config });
    },
  };

  registerSqlExecContractTests("PostgresStore", factory);
  registerSqlViewsContractTests("PostgresStore", factory);
  registerSqlRetentionContractTests("PostgresStore", factory);
  registerSqlSignalContractTests("PostgresStore", factory);
  registerSqlTimersAndCommandsContractTests("PostgresStore", factory);
});
