import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { MemoryQueue } from "../../../../durable/queue/MemoryQueue";
import { waitUntil } from "../../../../durable/test-utils";

/**
 * Starts the documented saga: reserve (with compensation), then a slow step
 * that only settles on abort, rolling back in its catch block.
 */
async function startSaga(name: string) {
  const store = new MemoryStore();
  const durable = durableResource.fork(`durable-tests-saga-abort-${name}`);
  const effects: string[] = [];
  let inSlowStep = false;

  const task = r
    .task(`durable-test-saga-abort-${name}`)
    .dependencies({ durable })
    .run(async (_input: undefined, { durable }) => {
      const ctx = durable.use();
      await ctx
        .step<string>("reserve")
        .up(async () => "reserved")
        .down(async () => {
          effects.push("released");
        });
      try {
        await ctx.step("slow", async ({ signal }) => {
          inSlowStep = true;
          return await new Promise<number>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          );
        });
      } catch (error) {
        await ctx.rollback();
        effects.push("rolled-back");
        throw error;
      }
      return "done";
    })
    .build();

  const app = r
    .resource("app")
    .register([
      resources.durable,
      durable.with({
        store,
        eventBus: new MemoryEventBus(),
        polling: { interval: 5 },
        queue: new MemoryQueue(),
        roles: { queueConsumer: true },
      }),
      task,
    ])
    .build();
  const runtime = await run(app, {
    logs: { printThreshold: null },
    // Skip the drain so shutdown aborts the live attempt right away.
    dispose: { drainingBudgetMs: 0, abortWindowMs: 500, cooldownWindowMs: 0 },
  });
  const service = runtime.getResourceValue(durable);
  const executionId = await service.start(task, undefined);
  await waitUntil(() => inSlowStep, { timeoutMs: 2_000, intervalMs: 2 });
  return { store, service, runtime, executionId, effects };
}

describe("durable: aborting a live saga", () => {
  it("runs the compensations on cancel and ends cancelled", async () => {
    const { store, service, runtime, executionId, effects } =
      await startSaga("cancel");
    try {
      await service.cancelExecution(executionId, "stop");

      await waitUntil(
        async () =>
          (await store.getExecution(executionId))?.status ===
          ExecutionStatus.Cancelled,
        { timeoutMs: 2_000, intervalMs: 5 },
      );
      expect(effects).toEqual(["released", "rolled-back"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps the execution resumable when shutdown interrupts it", async () => {
    const { store, runtime, executionId, effects } =
      await startSaga("shutdown");

    await runtime.dispose();

    expect(effects).toEqual(["released", "rolled-back"]);
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Running,
    );
  });
});
