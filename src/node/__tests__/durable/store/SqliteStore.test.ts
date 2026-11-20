import { DatabaseSync } from "node:sqlite";
import { r, run } from "../../../../public";
import { resources, tags } from "../../../node";
import { SqliteStore } from "../../../durable/store/SqliteStore";
import { registerSqlExecContractTests } from "./sqlStoreContract.exec.helpers";
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
