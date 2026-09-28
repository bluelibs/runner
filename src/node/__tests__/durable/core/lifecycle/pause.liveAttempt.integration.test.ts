import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { waitUntil } from "../../../../durable/test-utils";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const tick = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function setupWorkflow(
  name: string,
  body: (ctx: IDurableContext) => Promise<string>,
  maxAttempts?: number,
) {
  const store = new MemoryStore();
  const durable = durableResource.fork(`durable-tests-live-pause-${name}`);
  const durableRegistration = durable.with({
    store,
    eventBus: new MemoryEventBus(),
    polling: { interval: 5 },
    execution: maxAttempts ? { maxAttempts } : undefined,
  });
  const task = r
    .task(`durable-test-live-pause-${name}`)
    .dependencies({ durable })
    .run(async (_input: undefined, { durable }) => await body(durable.use()))
    .build();
  const app = r
    .resource("app")
    .register([resources.durable, durableRegistration, task])
    .build();
  const runtime = await run(app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(durable);
  void service.start(task, undefined, { timeout: 5_000 }).catch(() => {});

  await waitUntil(
    async () =>
      (await store.listIncompleteExecutions()).some(
        (execution) => execution.status === ExecutionStatus.Running,
      ),
    { timeoutMs: 1_000, intervalMs: 2 },
  );
  const executionId = (await store.listIncompleteExecutions())[0].id;
  return { store, service, runtime, executionId };
}

describe("durable: pausing a live attempt", () => {
  it("starts no further durable operation once paused", async () => {
    const gate = createDeferred();
    const effects: string[] = [];
    const { store, service, runtime, executionId } = await setupWorkflow(
      "gate",
      async (ctx) => {
        // s1 deliberately ignores its abort signal.
        await ctx.step("s1", async () => {
          await gate.promise;
          return 1;
        });
        await ctx.step("s2", async () => {
          effects.push("s2");
          return 2;
        });
        await ctx.step("s3", async () => {
          effects.push("s3");
          return 3;
        });
        return "done";
      },
    );

    await service.pauseExecution(executionId);
    gate.resolve();
    await tick(100);

    expect(effects).toEqual([]);
    expect(await store.getStepResult(executionId, "s2")).toBeNull();
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );

    await service.resumeExecution(executionId);
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("done");
    expect(effects).toEqual(["s2", "s3"]);

    await runtime.dispose();
  });

  it("does not burn an attempt when resume lands before the aborted attempt settles", async () => {
    let stepRuns = 0;
    const { store, service, runtime, executionId } = await setupWorkflow(
      "quick-resume",
      async (ctx) => {
        await ctx.step("s1", async ({ signal }) => {
          stepRuns += 1;
          if (stepRuns > 1) return 1;
          // Reacts to the pause abort only after resume already flipped the
          // execution back to running.
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              setTimeout(() => reject(new Error("aborted cleanup")), 50),
            ),
          );
          return 1;
        });
        return "done";
      },
      1,
    );

    await service.pauseExecution(executionId);
    await service.resumeExecution(executionId);

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("done");
    const execution = await store.getExecution(executionId);
    expect(execution?.status).toBe(ExecutionStatus.Completed);
    expect(execution?.attempt).toBe(1);
    expect(stepRuns).toBe(2);

    await runtime.dispose();
  });

  it("re-drives a resumed execution whose kickoff lost the lock race to the dropped attempt", async () => {
    const gate = createDeferred();
    let runs = 0;
    const { store, service, runtime, executionId } = await setupWorkflow(
      "lock-race",
      async (ctx) => {
        runs += 1;
        const firstRun = runs === 1;
        await ctx.step("s1", async () => {
          if (firstRun) await gate.promise;
          return 1;
        });
        return "done";
      },
    );

    const releaseLock = store.releaseLock.bind(store);
    const heldRelease = createDeferred();
    let holdRelease = false;
    store.releaseLock = async (resource, lockId) => {
      if (holdRelease && resource.startsWith("execution:")) {
        await heldRelease.promise;
      }
      return await releaseLock(resource, lockId);
    };

    await service.pauseExecution(executionId);
    holdRelease = true;
    gate.resolve();
    await tick(50);

    // The dropped attempt still holds the execution lock, so resume's own
    // kickoff contends and returns without running anything.
    await service.resumeExecution(executionId);
    holdRelease = false;
    heldRelease.resolve();

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("done");
    expect(runs).toBe(2);

    await runtime.dispose();
  });
});
