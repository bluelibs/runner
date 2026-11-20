import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ExecutionStatus } from "../../../durable/core/types";
import { SqliteStore } from "../../../durable/store/SqliteStore";
import { makeSqlExecution } from "./sqlStoreContract.exec.helpers";
import { createSqliteBackend } from "../../../durable/store/sql/sqliteBackend";
import { SqlDurableStore } from "../../../durable/store/sql/SqlDurableStore";

describe("durable: SqliteStore persistence and lifecycle", () => {
  it("persists state to a file database across dispose and reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
    const dbPath = join(dir, "nested", "durable.sqlite");
    try {
      const s1 = new SqliteStore({
        filename: dbPath,
        busyTimeoutMs: 2_500,
        namespace: "app-1",
      });
      await s1.saveExecution(
        makeSqlExecution("persisted-1", { status: ExecutionStatus.Completed }),
      );
      await s1.dispose();

      expect(existsSync(dbPath)).toBe(true);

      const s2 = new SqliteStore({ filename: dbPath, namespace: "app-1" });
      try {
        expect((await s2.getExecution("persisted-1"))?.id).toBe("persisted-1");
      } finally {
        await s2.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports file: URIs without mkdir and leaves caller-owned databases open on dispose", async () => {
    const uriStore = new SqliteStore({
      filename: "file::memory:?cache=shared",
    });
    await uriStore.saveExecution(makeSqlExecution("uri-exec"));
    await uriStore.dispose();

    const rawDb = new DatabaseSync(":memory:");
    const closeSpy = jest.spyOn(rawDb, "close");
    const externalStore = new SqliteStore({
      database: rawDb as never,
      filename: ":memory:",
    });
    await externalStore.saveExecution(makeSqlExecution("ext-exec"));
    expect((await externalStore.getExecution("ext-exec"))?.id).toBe("ext-exec");
    await externalStore.dispose();
    expect(closeSpy).not.toHaveBeenCalled();
    rawDb.close();

    const backend = createSqliteBackend();
    await backend.init(["CREATE TABLE IF NOT EXISTS t_cov (v INTEGER)"]);
    await backend.run("INSERT INTO t_cov VALUES (1)");
    await expect(backend.get("SELECT v FROM t_cov")).resolves.toEqual({ v: 1 });
    await expect(backend.all("SELECT v FROM t_cov")).resolves.toEqual([
      { v: 1 },
    ]);
    await backend.transaction(async (tx) => {
      await tx.run("INSERT INTO t_cov VALUES (2)");
      await expect(tx.get("SELECT COUNT(*) AS c FROM t_cov")).resolves.toEqual({
        c: 2,
      });
      await expect(tx.all("SELECT v FROM t_cov")).resolves.toHaveLength(2);
    });
    const baseStore = new SqlDurableStore(backend);
    await expect(baseStore.listExecutions()).resolves.toEqual([]);
    await backend.dispose();

    const defaultStore = new SqliteStore();
    await defaultStore.saveExecution(makeSqlExecution("def-exec"));
    await defaultStore.dispose();
  });
});
