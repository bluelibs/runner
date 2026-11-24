import { createSqliteBackend } from "../../../durable/store/sql/sqliteBackend";
import { createPostgresBackend } from "../../../durable/store/sql/postgresBackend";
import type { SqliteDatabaseLike } from "../../../durable/optionalDeps/sqlite";
import type { PgPoolLike } from "../../../durable/optionalDeps/pg";

describe("durable: SQL statement/rewrite caches", () => {
  it("sqlite prepares each distinct statement once and stays bounded", async () => {
    const prepare = jest.fn(() => ({
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(() => []),
    }));
    const database: SqliteDatabaseLike = {
      exec: jest.fn(),
      prepare,
      close: jest.fn(),
    };
    const backend = createSqliteBackend({ database });

    await backend.all("SELECT 1");
    await backend.get("SELECT 1");
    await backend.run("SELECT 1");
    await backend.transaction((tx) => tx.get("SELECT 1"));
    expect(prepare).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 257; i += 1) await backend.all(`SELECT ${i}`);
    expect(prepare).toHaveBeenCalledTimes(257);
    await backend.all("SELECT 1");
    expect(prepare).toHaveBeenCalledTimes(258);

    await backend.dispose();
    expect(database.close).not.toHaveBeenCalled();
    await backend.get("SELECT 1");
    expect(prepare).toHaveBeenCalledTimes(259);
  });

  it("postgres preserves bind positions for repeated and evicted statements", async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const pool: PgPoolLike = {
      query,
      connect: jest.fn(),
    };
    const backend = createPostgresBackend({ pool });

    await backend.run("DELETE FROM t WHERE a = ?", [1]);
    await backend.run("DELETE FROM t WHERE a = ?", [2]);
    expect(query).toHaveBeenNthCalledWith(1, "DELETE FROM t WHERE a = $1", [1]);
    expect(query).toHaveBeenNthCalledWith(2, "DELETE FROM t WHERE a = $1", [2]);

    for (let i = 0; i < 600; i += 1) await backend.run(`SELECT ? + ${i}`, [i]);
    await backend.run("DELETE FROM t WHERE a = ?", [3]);
    expect(query).toHaveBeenLastCalledWith("DELETE FROM t WHERE a = $1", [3]);
  });
});
