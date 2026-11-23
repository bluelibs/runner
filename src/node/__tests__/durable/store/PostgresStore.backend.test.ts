import {
  createPostgresBackend,
  rewritePgPlaceholders,
} from "../../../durable/store/sql/postgresBackend";
import * as pgOptional from "../../../durable/optionalDeps/pg";
import type { PgPoolLike } from "../../../durable/optionalDeps/pg";

describe("durable: Postgres backend & placeholder rewriting", () => {
  afterEach(() => jest.restoreAllMocks());

  it("rewrites unquoted ? placeholders while preserving string literals", () => {
    expect(
      rewritePgPlaceholders(
        "SELECT * FROM t WHERE a = ? AND b = 'x?y''?' AND c = ?",
      ),
    ).toBe("SELECT * FROM t WHERE a = $1 AND b = 'x?y''?' AND c = $2");
  });

  it("validates configuration presence", () => {
    expect(() => createPostgresBackend({})).toThrow(/PostgresStore requires/);
  });

  it("creates owned pools from connectionString/poolConfig and ends them cleanly", async () => {
    const release = jest.fn();
    const query = jest.fn(async () => ({ rows: [{ id: "1" }] }));
    const end = jest.fn(async () => {});
    const fakePool: PgPoolLike = {
      query: query as never,
      connect: jest.fn(async () => ({ query: query as never, release })),
      end,
    };
    const spy = jest
      .spyOn(pgOptional, "createPgPool")
      .mockReturnValue(fakePool);

    const b1 = createPostgresBackend({
      connectionString: "postgres://local/db",
    });
    await expect(b1.get("SELECT 1")).resolves.toEqual({ id: "1" });
    await expect(b1.get("SELECT ?", ["y"])).resolves.toEqual({ id: "1" });
    await expect(b1.all("SELECT 1")).resolves.toEqual([{ id: "1" }]);
    await expect(b1.all("SELECT ?", ["x"])).resolves.toEqual([{ id: "1" }]);
    await b1.run("DELETE FROM t");
    await b1.run("DELETE FROM t WHERE id = ?", ["1"]);
    await b1.dispose();
    await b1.dispose();
    expect(spy).toHaveBeenCalledWith("postgres://local/db");
    expect(end).toHaveBeenCalledTimes(1);

    const b2 = createPostgresBackend({ poolConfig: { max: 5 } });
    await b2.dispose();
    await b2.init(["SELECT 1"]);
    await b2.dispose();
    expect(spy).toHaveBeenCalledWith({ max: 5 });

    const noEndPool: PgPoolLike = {
      query: jest.fn(async () => ({ rows: [] })) as never,
      connect: jest.fn(async () => ({
        query: jest.fn(async () => ({ rows: [] })) as never,
        release,
      })),
    };
    spy.mockReturnValueOnce(noEndPool);
    const b3 = createPostgresBackend({
      connectionString: "postgres://no-end/db",
    });
    await b3.transaction(async (tx) => {
      await tx.run("SELECT 1");
      await expect(tx.get("SELECT 1")).resolves.toBeNull();
      await expect(tx.all("SELECT 1")).resolves.toEqual([]);
    });
    await b3.dispose();
  });

  it("leaves caller-owned pool open on dispose and rolls back failed transactions", async () => {
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback-err");
      return { rows: [] };
    });
    const end = jest.fn(async () => {});
    const pool: PgPoolLike = {
      query: jest.fn(async () => ({ rows: [] })),
      connect: jest.fn(async () => ({ query: clientQuery as never, release })),
      end,
    };

    const backend = createPostgresBackend({ pool });
    await expect(
      backend.transaction(async () => {
        throw new Error("tx-failure");
      }),
    ).rejects.toThrow("tx-failure");
    expect(clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledWith(true);
    await backend.dispose();
    expect(end).not.toHaveBeenCalled();
  });

  it("merges connectionString with poolConfig, attaches pool error listener, destroys broken BEGIN clients, and skips existing DDL", async () => {
    const errorListeners: Array<(err: Error) => void> = [];
    const release = jest.fn();
    let failBegin = false;
    const clientQuery = jest.fn(async (sql: string) => {
      if (sql === "BEGIN" && failBegin) throw new Error("begin-broken");
      return { rows: [] };
    });
    const poolQuery = jest.fn(async (sql: string) => {
      if (sql.includes("FROM pg_tables")) {
        return { rows: [{ name: "t_one" }, { name: "idx_one" }] };
      }
      return { rows: [] };
    });
    const fakePool: PgPoolLike = {
      query: poolQuery as never,
      connect: jest.fn(async () => ({ query: clientQuery as never, release })),
      end: jest.fn(async () => {}),
      on: jest.fn((_event, listener) => {
        errorListeners.push(listener);
      }),
    };
    const spy = jest
      .spyOn(pgOptional, "createPgPool")
      .mockReturnValue(fakePool);

    const backend = createPostgresBackend({
      connectionString: "postgres://local/db",
      poolConfig: { max: 25 },
    });

    // All DDL objects already exist -> init skips advisory-locked DDL transaction.
    await backend.init([
      "CREATE TABLE IF NOT EXISTS t_one (id TEXT)",
      "CREATE INDEX IF NOT EXISTS idx_one ON t_one (id)",
    ]);
    expect(spy).toHaveBeenCalledWith({
      max: 25,
      connectionString: "postgres://local/db",
    });
    expect(errorListeners).toHaveLength(1);
    expect(() => errorListeners[0]!(new Error("idle-drop"))).not.toThrow();
    expect(clientQuery).not.toHaveBeenCalled();

    // BEGIN failure destroys the client without attempting ROLLBACK.
    failBegin = true;
    await expect(backend.transaction(async () => "nope")).rejects.toThrow(
      "begin-broken",
    );
    expect(release).toHaveBeenCalledWith(true);
    expect(clientQuery).not.toHaveBeenCalledWith("ROLLBACK");

    await backend.dispose();
  });
});
