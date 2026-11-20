import { randomUUID } from "node:crypto";
import { r, run } from "../../../../public";
import { resources, tags } from "../../../node";
import { PostgresStore } from "../../../durable/store/PostgresStore";
import { registerSqlExecContractTests } from "./sqlStoreContract.exec.helpers";
import { registerSqlViewsContractTests } from "./sqlStoreContract.viewsRetention.helpers";
import { registerSqlRetentionContractTests } from "./sqlStoreContract.retention.helpers";
import { registerSqlSignalContractTests } from "./sqlStoreContract.signals.helpers";
import { registerSqlTimersAndCommandsContractTests } from "./sqlStoreContract.timersCommands.helpers";
import { registerPostgresConcurrencyTests } from "./postgresConcurrency.helpers";

const postgresUrl =
  process.env.REAL_INFRASTRUCTURE_POSTGRES_URL ??
  process.env.DURABLE_TEST_POSTGRES_URL;
const describeIfPostgres = postgresUrl ? describe : describe.skip;

describeIfPostgres("durable: PostgresStore (real integration)", () => {
  const runNamespacePrefix = `runner-real-${randomUUID()}`;
  const factory = {
    createStore: async (config?: {
      namespace?: string;
      autoCreateTables?: boolean;
    }) =>
      new PostgresStore({
        connectionString: postgresUrl!,
        namespace: `${runNamespacePrefix}:${config?.namespace ?? "default"}`,
        autoCreateTables: config?.autoCreateTables,
      }),
  };

  registerSqlExecContractTests("PostgresStore(real)", factory);
  registerSqlViewsContractTests("PostgresStore(real)", factory);
  registerSqlRetentionContractTests("PostgresStore(real)", factory);
  registerSqlSignalContractTests("PostgresStore(real)", factory);
  registerSqlTimersAndCommandsContractTests("PostgresStore(real)", factory);
  registerPostgresConcurrencyTests(postgresUrl!);

  it("executes a real Postgres workflow via postgresWorkflow with two-stage receipt retention", async () => {
    const namespace = `${runNamespacePrefix}:e2e`;
    const approve = r.event<{ ok: boolean }>("approve").build();
    const durableRes = resources.postgresWorkflow.fork("pg-real-e2e-durable");
    const durableRegistration = durableRes.with({
      namespace,
      postgres: { connectionString: postgresUrl! },
      timers: { enabled: true, pollIntervalMs: 10 },
      garbageCollection: { enabled: false },
    });

    const task = r
      .task("pg-real-e2e")
      .dependencies({ durable: durableRes })
      .tags([
        tags.durableWorkflow.with({
          signals: [approve],
          retention: {
            onComplete: { afterMs: 50 },
            receipts: { afterMs: 250 },
          },
        }),
      ])
      .run(async (input: number, { durable }) => {
        const d = durable.use();
        const doubled = await d.step("double", async () => input * 2);
        await d.replaceState({ doubled });
        const sig = await d.waitForSignal(approve);
        return { doubled, sig };
      })
      .build();

    const app = r
      .resource("app-pg-real-e2e")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app);
    const store = new PostgresStore({
      connectionString: postgresUrl!,
      namespace,
    });
    try {
      const durable = runtime.getResourceValue(durableRes);
      const id = await durable.start(task, 21, { idempotencyKey: "real-k" });
      await durable.signal(id, approve, { ok: true });
      await expect(durable.wait(id)).resolves.toEqual({
        doubled: 42,
        sig: { kind: "signal", payload: { ok: true } },
      });
      const exec = (await store.getExecution(id))!;
      const at = exec.completedAt!.getTime();
      expect(await store.collectCompletedHistory(new Date(at + 60), 10)).toBe(
        1,
      );
      expect(await store.collectExpiredReceipts(new Date(at + 300), 10)).toBe(
        1,
      );
      expect(await store.getExecution(id)).toBeNull();
    } finally {
      await store.dispose();
      await runtime.dispose();
    }
  });
});
