import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../../../durable/core/types";
import { waitUntil } from "../../../../durable/test-utils";

type CounterState = { page: number; total: number };

describe("durable: workflow state (integration)", () => {
  it("converges state across suspend and resume", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-state-replay");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-state-replay")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.setState<CounterState>({ page: 1 });
        await ctx.sleep(20, { stepId: "nap" });
        await ctx.setState<CounterState>({ total: 10 });
        return await ctx.getState<CounterState>();
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined);
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ page: 1, total: 10 });
    await expect(service.getState(executionId)).resolves.toEqual({
      page: 1,
      total: 10,
    });

    await runtime.dispose();
  });

  it("chains pause, resume, continueAsNew, wait-following, and restart with carried and fresh state", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-state-scenario");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    type ScenarioState = { chapters: number[] };
    const task = r
      .task("durable-test-state-scenario")
      .dependencies({ durable })
      .run(async (input: { chapter: number }, { durable }) => {
        const ctx = durable.use();
        // State writes re-execute on replay (sleep/pause resume re-runs the
        // prefix), so derivations must be idempotent: guard the append.
        const prior = (await ctx.getState<ScenarioState>())?.chapters ?? [];
        const next = {
          chapters: prior.includes(input.chapter)
            ? prior
            : [...prior, input.chapter],
        };
        await ctx.replaceState<ScenarioState>(next);
        if (input.chapter === 0) {
          await ctx.sleep(1_000, { stepId: "settle" });
          await ctx.continueAsNew({ chapter: 1 });
          throw new Error("unreachable: continueAsNew never returns");
        }
        if (input.chapter === 1) {
          await ctx.continueAsNew({ chapter: 2 });
          throw new Error("unreachable: continueAsNew never returns");
        }
        return next;
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const rootId = await service.start(task, { chapter: 0 });
    await waitUntil(
      async () =>
        (await store.getExecution(rootId))?.status === ExecutionStatus.Sleeping,
      { timeoutMs: 5_000, intervalMs: 5 },
    );

    await service.pauseExecution(rootId);
    expect((await store.getExecution(rootId))?.status).toBe(
      ExecutionStatus.Paused,
    );
    await expect(service.getState(rootId)).resolves.toEqual({
      chapters: [0],
    });

    await service.resumeExecution(rootId);
    await expect(
      service.wait(rootId, { timeout: 10_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ chapters: [0, 1, 2] });

    const root = await store.getExecution(rootId);
    const middle = await store.getExecution(root?.continuedAsExecutionId ?? "");
    const tip = await store.getExecution(middle?.continuedAsExecutionId ?? "");
    expect(middle?.continuedFromExecutionId).toBe(rootId);
    expect(tip?.continuedFromExecutionId).toBe(middle?.id);
    await expect(service.getState(rootId)).resolves.toEqual({
      chapters: [0],
    });
    await expect(service.getState(middle?.id ?? "")).resolves.toEqual({
      chapters: [0, 1],
    });
    await expect(service.getState(tip?.id ?? "")).resolves.toEqual({
      chapters: [0, 1, 2],
    });
    await expect(
      service.operator.getExecutionDetail(tip?.id ?? ""),
    ).resolves.toEqual(
      expect.objectContaining({
        state: expect.objectContaining({
          executionId: tip?.id,
          state: { chapters: [0, 1, 2] },
        }),
      }),
    );

    const restartedId = await service.restartExecution(tip?.id ?? "", {
      input: { chapter: 2 },
    });
    await expect(
      service.wait(restartedId, { timeout: 10_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ chapters: [2] });
    const restarted = await store.getExecution(restartedId);
    expect(restarted?.restartedFromExecutionId).toBe(tip?.id);

    await runtime.dispose();
  });
});
