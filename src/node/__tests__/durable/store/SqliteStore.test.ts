import { DatabaseSync } from "node:sqlite";
import { r, run } from "../../../../public";
import { resources, tags } from "../../../node";
import { TimerStatus, TimerType } from "../../../durable/core/types";
import { SqliteStore } from "../../../durable/store/SqliteStore";
import { createSqliteBackend } from "../../../durable/store/sql/sqliteBackend";
import {
  makeSqlExecution,
  registerSqlExecContractTests,
} from "./sqlStoreContract.exec.helpers";
import { registerSqlViewsContractTests } from "./sqlStoreContract.viewsRetention.helpers";
import { registerSqlRetentionContractTests } from "./sqlStoreContract.retention.helpers";
import { registerSqlSignalContractTests } from "./sqlStoreContract.signals.helpers";
import { registerSqlTimersAndCommandsContractTests } from "./sqlStoreContract.timersCommands.helpers";

describe("durable: SqliteStore", () => {
  const factory = {
    createStore: async (config?: {
      namespace?: string;
      autoCreateTables?: boolean;
    }) => new SqliteStore(config),
  };

  registerSqlExecContractTests("SqliteStore", factory);
  registerSqlViewsContractTests("SqliteStore", factory);
  registerSqlRetentionContractTests("SqliteStore", factory);
  registerSqlSignalContractTests("SqliteStore", factory);
  registerSqlTimersAndCommandsContractTests("SqliteStore", factory);

  it("claims timers across the SQLite 999-variable bind limit", async () => {
    const database = new DatabaseSync(":memory:");
    const store = new SqliteStore({
      database: {
        exec: (sql) => database.exec(sql),
        prepare: (sql) => {
          if ((sql.match(/\?/g)?.length ?? 0) > 999) {
            throw new Error("too many SQL variables");
          }
          return database.prepare(sql);
        },
        close: () => database.close(),
      },
    });
    const fireAt = new Date(0);
    const ids = Array.from({ length: 200 }, (_, index) =>
      String(index).padStart(3, "0"),
    );
    try {
      for (const id of ids) {
        await store.createTimer({
          id,
          type: TimerType.Sleep,
          fireAt,
          status: TimerStatus.Pending,
        });
      }
      const claimed = await store.claimReadyTimers(
        fireAt,
        ids.length,
        "worker",
        60_000,
      );
      expect(claimed.map((timer) => timer.id)).toEqual(ids);
      await expect(
        store.claimReadyTimers(fireAt, ids.length, "other-worker", 60_000),
      ).resolves.toEqual([]);
    } finally {
      await store.dispose();
      database.close();
    }
  });

  it("serializes stores sharing the same injected connection", async () => {
    const database = new DatabaseSync(":memory:");
    const first = new SqliteStore({ database, namespace: "first" });
    const second = new SqliteStore({ database, namespace: "second" });
    try {
      await Promise.all([first.init(), second.init()]);
      await Promise.all([
        first.saveExecution(makeSqlExecution("first")),
        second.saveExecution(makeSqlExecution("second")),
      ]);
      expect(await first.getExecution("first")).not.toBeNull();
      expect(await second.getExecution("second")).not.toBeNull();
      expect(await second.getExecution("first")).toBeNull();
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
      database.close();
    }
  });

  it("waits for a shared connection transaction to settle before reading", async () => {
    const database = new DatabaseSync(":memory:");
    const writer = createSqliteBackend({ database });
    const reader = createSqliteBackend({ database });
    let notifyInserted!: () => void;
    const inserted = new Promise<void>((resolve) => {
      notifyInserted = resolve;
    });
    let triggerRollback!: () => void;
    const rollback = new Promise<void>((resolve) => {
      triggerRollback = resolve;
    });
    try {
      await writer.init(["CREATE TABLE sample (value TEXT)"]);
      const transaction = writer.transaction(async (tx) => {
        await tx.run("INSERT INTO sample VALUES (?)", ["uncommitted"]);
        notifyInserted();
        await rollback;
        throw new Error("rollback requested");
      });
      await inserted;
      const observed = reader.get("SELECT value FROM sample");
      triggerRollback();
      await expect(transaction).rejects.toThrow("rollback requested");
      await expect(observed).resolves.toBeNull();
    } finally {
      triggerRollback();
      database.close();
    }
  });

  it("runs a durable workflow with steps, state, signals, and two-stage retention via sqliteWorkflow resource", async () => {
    const db = new DatabaseSync(":memory:");
    const approve = r.event<{ ok: boolean }>("approve").build();
    const durableRes = resources.sqliteWorkflow.fork("sqlite-e2e-durable");
    const durableRegistration = durableRes.with({
      namespace: "sqlite-e2e-ns",
      persist: { database: db as never },
      timers: { enabled: true, pollIntervalMs: 10 },
      garbageCollection: { enabled: false },
    });

    const workflow = r
      .task("sqlite-e2e")
      .dependencies({ durable: durableRes })
      .tags([
        tags.durableWorkflow.with({
          signals: [approve],
          retention: {
            onComplete: { afterMs: 100 },
            receipts: { afterMs: 500 },
          },
        }),
      ])
      .run(async (input: { name: string }, { durable }) => {
        const d = durable.use();
        const stepVal = await d.step("greet", async () => `hi:${input.name}`);
        await d.replaceState({ greeted: stepVal });
        const sig = await d.waitForSignal(approve);
        const state = await d.getState<{ greeted: string }>();
        return { greeted: state?.greeted, sig };
      })
      .build();

    const app = r
      .resource("app-sqlite-e2e")
      .register([resources.durable, durableRegistration, workflow])
      .build();

    const runtime = await run(app);
    const store = new SqliteStore({
      database: db as never,
      namespace: "sqlite-e2e-ns",
    });
    try {
      const durable = runtime.getResourceValue(durableRes);
      const execId = await durable.start(
        workflow,
        { name: "ada" },
        { idempotencyKey: "k-e2e" },
      );
      await durable.signal(execId, approve, { ok: true });
      const expected = {
        greeted: "hi:ada",
        sig: { kind: "signal", payload: { ok: true } },
      };
      expect(await durable.wait(execId)).toEqual(expected);

      const exec = (await store.getExecution(execId))!;
      const completedAt = exec.completedAt!.getTime();
      expect(
        await store.collectCompletedHistory(new Date(completedAt + 150), 10),
      ).toBe(1);
      expect(await store.listStepResults(execId)).toEqual([]);
      expect((await store.getExecution(execId))?.result).toEqual(expected);

      expect(
        await store.collectExpiredReceipts(new Date(completedAt + 600), 10),
      ).toBe(1);
      expect(await store.getExecution(execId)).toBeNull();
    } finally {
      await store.dispose();
      await runtime.dispose();
      db.close();
    }
  });
});
