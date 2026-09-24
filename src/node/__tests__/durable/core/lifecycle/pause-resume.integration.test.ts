import { defineEvent, r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { waitUntil } from "../../../../durable/test-utils";

const Paid = defineEvent<{ paidAt: number }>({
  id: "durable-tests-pause-paid",
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("durable: pause/resume (integration)", () => {
  it("buffers signals delivered while paused and resumes without loss", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-pause-signals");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-pause-signal")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const payment = await ctx.waitForSignal(Paid);
        return { ok: true, paidAt: payment.payload.paidAt };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
    });
    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 1_000, intervalMs: 5 },
    );

    await service.pauseExecution(executionId);
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );

    await service.signal(executionId, Paid, { paidAt: 7 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );

    await service.resumeExecution(executionId);
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ ok: true, paidAt: 7 });

    await runtime.dispose();
  });

  it("catches up timers that fired while paused", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-pause-timers");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-pause-sleep")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.sleep(60, { stepId: "nap" });
        return "woke";
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
    });
    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 1_000, intervalMs: 5 },
    );

    await service.pauseExecution(executionId);

    // The sleep deadline passes while paused: wall-clock timers still fire,
    // but the execution stays parked until resume re-kicks it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );
    const sleepStep = await store.getStepResult(executionId, "__sleep:nap");
    expect(sleepStep?.result).toEqual({ state: "completed" });

    await service.resumeExecution(executionId);
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("woke");

    await runtime.dispose();
  });

  it("drops the late outcome of a paused attempt and reruns on resume", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-pause-rerun");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const gate = createDeferred<void>();
    const runs: string[] = [];
    const task = r
      .task("durable-test-pause-gate")
      .dependencies({ durable })
      .run(async (_input: undefined) => {
        runs.push("run");
        await gate.promise;
        runs.push("settled");
        return "gate-ok";
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const saveExecutionIfStatus = store.saveExecutionIfStatus.bind(store);
    let saves = 0;
    store.saveExecutionIfStatus = async (...args) => {
      saves += 1;
      return await saveExecutionIfStatus(...args);
    };

    const startPromise = service.start(task, undefined, { timeout: 5_000 });
    await waitUntil(
      async () =>
        (await store.listIncompleteExecutions()).some(
          (execution) => execution.status === ExecutionStatus.Running,
        ),
      { timeoutMs: 1_000, intervalMs: 5 },
    );
    const executionId = (await store.listIncompleteExecutions()).find(
      (execution) => execution.status === ExecutionStatus.Running,
    )!.id;

    await service.pauseExecution(executionId);
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );

    const savesBeforeSettle = saves;
    gate.resolve();
    await waitUntil(async () => saves > savesBeforeSettle, {
      timeoutMs: 1_000,
      intervalMs: 5,
    });
    expect((await store.getExecution(executionId))?.status).toBe(
      ExecutionStatus.Paused,
    );

    await service.resumeExecution(executionId);
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("gate-ok");
    await expect(startPromise).resolves.toBe(executionId);
    expect(runs).toEqual(["run", "settled", "run", "settled"]);

    await runtime.dispose();
  });
});
