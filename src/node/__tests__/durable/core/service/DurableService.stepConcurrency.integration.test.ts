import { randomUUID } from "node:crypto";
import { r, resources, run, tags } from "../../../..";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { RedisStore } from "../../../../durable/store/RedisStore";
import { waitUntil } from "../../../../durable/test-utils";
import { gate } from "../durable-context/stepConcurrency.helpers";

const redisUrl = process.env.DURABLE_TEST_REDIS_URL;

function stepConcurrencyTests(backend: "memory" | "redis") {
  it.each([false, true])(
    "coordinates separate workers, replays preparation, and frees workflow admission (shared key: %s)",
    async (sharedKey) => {
      const prefix = `runner:step-concurrency:${randomUUID()}:`;
      const firstStore =
        backend === "memory"
          ? new MemoryStore()
          : new RedisStore({ redis: redisUrl!, prefix });
      const secondStore =
        backend === "memory"
          ? firstStore
          : new RedisStore({ redis: redisUrl!, prefix });
      const durable = durableResource.fork("step-concurrency");
      const releases = [gate(), gate(), gate()];
      const prepared: number[] = [];
      const started: number[] = [];
      let active = 0;
      let maximum = 0;
      const createWorkflow = (id: string) =>
        r
          .task(id)
          .tags([
            tags.durableWorkflow.with({
              key: id,
              concurrency: sharedKey ? 1 : 2,
            }),
          ])
          .dependencies({ durable })
          .run(async (input: { id: number }, { durable }) => {
            const d = durable.use();
            await d.step("prepare", async () => {
              prepared.push(input.id);
              return input.id;
            });
            return await d.step(
              sharedKey ? `charge-${id}` : "charge",
              {
                concurrency: sharedKey
                  ? { key: "payments.charge", limit: 1 }
                  : 1,
              },
              async () => {
                active += 1;
                maximum = Math.max(maximum, active);
                started.push(input.id);
                try {
                  await releases[input.id - 1].promise;
                  return input.id;
                } finally {
                  active -= 1;
                }
              },
            );
          })
          .build();
      const orders = createWorkflow("orders");
      const invoices = createWorkflow("invoices");
      const app = (store: typeof firstStore) =>
        r
          .resource("app")
          .register([
            resources.durable,
            durable.with({
              store,
              eventBus: new MemoryEventBus(),
              polling: { interval: 5 },
            }),
            orders,
            invoices,
          ])
          .build();
      const firstRuntime = await run(app(firstStore), {
        logs: { printThreshold: null },
      });
      const secondRuntime = await run(app(secondStore), {
        logs: { printThreshold: null },
      });
      const firstWorker = firstRuntime.getResourceValue(durable);
      const secondWorker = secondRuntime.getResourceValue(durable);
      const firstStart = firstWorker.start(orders, { id: 1 });
      try {
        await waitUntil(() => started.length === 1, {
          timeoutMs: 2000,
          intervalMs: 5,
        });
        const waitingWorkflow = sharedKey ? invoices : orders;
        const secondId = await secondWorker.start(waitingWorkflow, { id: 2 });
        expect((await secondStore.getExecution(secondId))?.status).toBe(
          "sleeping",
        );
        const thirdId = await firstWorker.start(waitingWorkflow, { id: 3 });
        expect((await firstStore.getExecution(thirdId))?.status).toBe(
          "sleeping",
        );
        expect(prepared).toEqual([1, 2, 3]);
        expect(started).toEqual([1]);
        releases[0].open();
        const firstId = await firstStart;
        await waitUntil(() => started.length === 2, {
          timeoutMs: 3000,
          intervalMs: 5,
        });
        releases[started[1] - 1].open();
        await waitUntil(() => started.length === 3, {
          timeoutMs: 3000,
          intervalMs: 5,
        });
        releases[started[2] - 1].open();
        await expect(
          Promise.all([
            firstWorker.wait(firstId),
            secondWorker.wait(secondId),
            firstWorker.wait(thirdId),
          ]),
        ).resolves.toEqual([1, 2, 3]);
        expect(prepared).toEqual([1, 2, 3]);
        expect(maximum).toBe(1);
        expect((await secondStore.getExecution(secondId))?.attempt).toBe(1);
      } finally {
        releases.forEach((release) => release.open());
        await firstStart;
        await Promise.all([firstRuntime.dispose(), secondRuntime.dispose()]);
      }
    },
    15000,
  );
  it("shares fixed-window callback starts across workers and resumes at the next window", async () => {
    const prefix = `runner:step-rate:${randomUUID()}:`;
    const firstStore =
      backend === "memory"
        ? new MemoryStore()
        : new RedisStore({ redis: redisUrl!, prefix });
    const secondStore =
      backend === "memory"
        ? firstStore
        : new RedisStore({ redis: redisUrl!, prefix });
    const durable = durableResource.fork("step-rate");
    const windowMs = 2000;
    const windows: number[] = [];
    const workflow = r
      .task("rate-workflow")
      .tags([tags.durableWorkflow.with({ key: "rate-workflow" })])
      .dependencies({ durable })
      .run(
        async (input: { id: number }, { durable }) =>
          await durable
            .use()
            .step(
              "send",
              { concurrency: { key: "provider-fixed", windowMs, max: 1 } },
              async () => {
                windows.push(Math.floor(Date.now() / windowMs));
                return input.id;
              },
            ),
      )
      .build();
    const app = (store: typeof firstStore) =>
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            store,
            eventBus: new MemoryEventBus(),
            polling: { interval: 5 },
          }),
          workflow,
        ])
        .build();
    const firstRuntime = await run(app(firstStore), {
      logs: { printThreshold: null },
    });
    const secondRuntime = await run(app(secondStore), {
      logs: { printThreshold: null },
    });
    try {
      // Begin with enough window remaining that a backend round trip cannot straddle its boundary.
      await waitUntil(() => windowMs - (Date.now() % windowMs) >= 1000, {
        timeoutMs: 2500,
        intervalMs: 5,
      });
      const firstWorker = firstRuntime.getResourceValue(durable);
      const secondWorker = secondRuntime.getResourceValue(durable);
      const firstId = await firstWorker.start(workflow, { id: 1 });
      const secondId = await secondWorker.start(workflow, { id: 2 });
      expect((await secondStore.getExecution(secondId))?.status).toBe(
        "sleeping",
      );
      expect(windows).toHaveLength(1);
      await expect(firstWorker.wait(firstId)).resolves.toBe(1);
      await expect(
        secondWorker.wait(secondId, { timeout: 4000, waitPollIntervalMs: 5 }),
      ).resolves.toBe(2);
      expect(windows).toHaveLength(2);
      expect(windows[1]).toBeGreaterThan(windows[0]);
      expect((await secondStore.getExecution(secondId))?.attempt).toBe(1);
    } finally {
      await Promise.all([firstRuntime.dispose(), secondRuntime.dispose()]);
    }
  }, 10000);
}

describe("durable: memory step concurrency", () => {
  stepConcurrencyTests("memory");
});
(redisUrl ? describe : describe.skip)("durable: Redis step concurrency", () => {
  stepConcurrencyTests("redis");
});
