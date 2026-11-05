import { randomUUID } from "node:crypto";
import { r, resources, run, tags } from "../../../..";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { RedisStore } from "../../../../durable/store/RedisStore";
import { waitUntil } from "../../../../durable/test-utils";

const redisUrl = process.env.DURABLE_TEST_REDIS_URL;

function retryTests(backend: "memory" | "redis") {
  it("preserves the callback retry budget when another worker resumes the parked execution", async () => {
    const prefix = `runner:step-retries:${randomUUID()}:`;
    const firstStore =
      backend === "memory"
        ? new MemoryStore()
        : new RedisStore({ redis: redisUrl!, prefix });
    const secondStore =
      backend === "memory"
        ? firstStore
        : new RedisStore({ redis: redisUrl!, prefix });
    const durable = durableResource.fork("step-retries");
    const windows: number[] = [];
    const workers: string[] = [];
    const workflow = r
      .task("retry-workflow")
      .tags([
        tags.durableWorkflow.with({ key: "retry-workflow", concurrency: 1 }),
      ])
      .dependencies({ durable })
      .run(
        async (_input: undefined, { durable }) =>
          await durable.use().step(
            "charge",
            {
              retries: 1,
              concurrency: {
                key: "failing-provider",
                windowMs: 2000,
                max: 1,
              },
            },
            async () => {
              windows.push(Math.floor(Date.now() / 2000));
              throw new Error("provider failed");
            },
          ),
      )
      .build();
    const app = (store: typeof firstStore, polling: boolean) =>
      r
        .resource("app")
        .register([
          resources.durable,
          durable.with({
            store,
            eventBus: new MemoryEventBus(),
            execution: { maxAttempts: 1 },
            polling: { enabled: polling, interval: 5 },
          }),
          workflow,
        ])
        .build();
    const firstRead = firstStore.getStepResult.bind(firstStore);
    const secondRead = secondStore.getStepResult.bind(secondStore);
    if (backend === "redis") {
      jest
        .spyOn(firstStore, "getStepResult")
        .mockImplementation(async (id, step) => {
          if (step.startsWith("__step-retries:")) workers.push("first");
          return await firstRead(id, step);
        });
      jest
        .spyOn(secondStore, "getStepResult")
        .mockImplementation(async (id, step) => {
          if (step.startsWith("__step-retries:")) workers.push("second");
          return await secondRead(id, step);
        });
    }
    const firstRuntime = await run(app(firstStore, false), {
      logs: { printThreshold: null },
    });
    const secondRuntime = await run(app(secondStore, true), {
      logs: { printThreshold: null },
    });
    try {
      await waitUntil(() => 2000 - (Date.now() % 2000) >= 1000, {
        timeoutMs: 2500,
        intervalMs: 5,
      });
      const firstWorker = firstRuntime.getResourceValue(durable);
      const secondWorker = secondRuntime.getResourceValue(durable);
      const id = await firstWorker.start(workflow, undefined);
      await expect(
        secondWorker.wait(id, { timeout: 6000, waitPollIntervalMs: 5 }),
      ).rejects.toThrow("provider failed");
      expect(windows).toHaveLength(2);
      expect(windows[1]).toBeGreaterThan(windows[0]);
      expect((await secondStore.getExecution(id))?.status).toBe("failed");
      expect((await secondStore.getExecution(id))?.attempt).toBe(1);
      if (backend === "redis")
        expect(workers).toEqual(expect.arrayContaining(["first", "second"]));
    } finally {
      await Promise.all([firstRuntime.dispose(), secondRuntime.dispose()]);
      jest.restoreAllMocks();
    }
  }, 10000);
}

describe("durable: memory step retry budgets", () => {
  retryTests("memory");
});
(redisUrl ? describe : describe.skip)(
  "durable: Redis step retry budgets",
  () => {
    retryTests("redis");
  },
);
