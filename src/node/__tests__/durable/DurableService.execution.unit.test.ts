import { r } from "../../..";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import type { IEventBus } from "../../durable/core/interfaces/bus";
import {
  DurableExecutionError,
  DurableService,
} from "../../durable/core/DurableService";
import type { Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  SpyQueue,
  createBareStore,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

describe("durable: DurableService — execution (unit)", () => {
  it("arms a kickoff failsafe timer and removes it after enqueue succeeds", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      queue: new SpyQueue(),
      tasks: [],
    });

    const task = okTask("t.kickoff-failsafe.success");
    await service.start(task);

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers).toEqual([]);
  });

  it("keeps the kickoff failsafe timer when enqueue fails", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      queue: {
        async enqueue() {
          throw new Error("queue-down");
        },
        async consume() {},
        async ack() {},
        async nack() {},
      },
      tasks: [],
    });

    const task = okTask("t.kickoff-failsafe.failure");
    await expect(service.start(task)).rejects.toThrow("queue-down");

    const [execution] = await store.listIncompleteExecutions();
    expect(execution).toBeDefined();

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers).toEqual([
      expect.objectContaining({
        id: `kickoff:${execution!.id}`,
        executionId: execution!.id,
      }),
    ]);
  });

  it("throws if execute is called without a taskExecutor", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store });
    const task = okTask("t");

    await expect(service.startAndWait(task)).rejects.toThrow("taskExecutor");
  });

  it("resolves a task by id string for execute/schedule", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.by-id")
      .run(async (input: { v: number }) => ({ v: input.v * 2 }))
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async (input) => {
          if (
            typeof input !== "object" ||
            input === null ||
            typeof (input as { v?: unknown }).v !== "number"
          ) {
            throw new Error("Expected { v: number } input");
          }
          return { v: (input as { v: number }).v * 2 };
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await expect(service.startAndWait(task.id, { v: 3 })).resolves.toEqual({
      v: 6,
    });

    const scheduleId = await service.schedule(task.id, { v: 2 }, { delay: 5 });
    const timers = await store.getReadyTimers(new Date(Date.now() + 1000));
    expect(scheduleId).toBeDefined();
    expect(timers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: task.id, id: `once:${scheduleId}` }),
      ]),
    );
  });

  it("fails fast when a string task id cannot be resolved", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [],
    });

    await expect(service.start("missing.task.id")).rejects.toThrow(
      'DurableService.start() could not resolve task id "missing.task.id"',
    );
    await expect(
      service.ensureSchedule("missing.task.id", undefined, {
        id: "s.missing",
        interval: 1000,
      }),
    ).rejects.toThrow(
      'DurableService.ensureSchedule() could not resolve task id "missing.task.id"',
    );
  });

  it("covers passthrough accessors and task registration", () => {
    const store = new MemoryStore();

    const customBus: IEventBus = {
      publish: async () => {},
      subscribe: async () => {},
      unsubscribe: async () => {},
    };

    const serviceWithBus = new DurableService({ store, eventBus: customBus });
    expect(serviceWithBus.getEventBus()).toBe(customBus);

    const serviceWithoutBus = new DurableService({ store });
    const noopBus = serviceWithoutBus.getEventBus();
    expect(typeof noopBus.publish).toBe("function");
    expect(typeof noopBus.subscribe).toBe("function");
    expect(typeof noopBus.unsubscribe).toBe("function");

    const task = okTask("t.register");
    serviceWithoutBus.registerTask(task);
    expect(serviceWithoutBus.findTask(task.id)).toBe(task);

    expect(serviceWithoutBus._pollingManager).toBeDefined();
    expect(serviceWithoutBus._executionManager).toBeDefined();
  });

  it("executes typed tasks via startAndWait()", async () => {
    const store = new MemoryStore();
    const task = okTask("t.strict");

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await expect(service.startAndWait(task)).resolves.toBe("ok");
  });

  it("marks execution failed when task is not registered", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await store.saveExecution(pendingExecution({ taskId: "missing" }));

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("failed");
  });

  it("processes executions even when the store does not implement locks", async () => {
    const base = new MemoryStore();
    const task = okTask("t.no-lock-store");

    const service = new DurableService({
      store: createBareStore(base),
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await base.saveExecution(pendingExecution({ taskId: task.id }));

    await service.processExecution("e1");
    expect((await base.getExecution("e1"))?.status).toBe("completed");
  });

  it("retries failing executions and eventually fails", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.fail")
      .run(async () => {
        throw new Error("x");
      })
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new Error("x");
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 2 },
    });

    await store.saveExecution(
      pendingExecution({ taskId: task.id, maxAttempts: 2 }),
    );

    await service.processExecution("e1");
    const after = await store.getExecution("e1");
    expect(after?.status).toBe("retrying");
    expect(after?.attempt).toBe(2);

    const retryTimers = await store.getReadyTimers(
      new Date(Date.now() + 60_000),
    );
    expect(retryTimers.some((t) => t.type === "retry")).toBe(true);

    await store.updateExecution("e1", { attempt: 2, status: "pending" });
    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("failed");
  });

  it("throws DurableExecutionError for failed executions via startAndWait()", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.throw")
      .run(async () => {
        throw new Error("boom");
      })
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new Error("boom");
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await expect(service.startAndWait(task)).rejects.toBeInstanceOf(
      DurableExecutionError,
    );
  });

  it("throws DurableExecutionError if completed without result", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.void")
      .run(async () => undefined)
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => undefined,
      }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await expect(service.startAndWait(task)).rejects.toBeInstanceOf(
      DurableExecutionError,
    );
  });

  it("sets execution to sleeping on SuspensionSignal", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sleep")
      .run(async () => {
        throw new SuspensionSignal("sleep");
      })
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
      tasks: [task],
    });

    await store.saveExecution(pendingExecution({ taskId: task.id }));

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("sleeping");
  });

  it("returns early if execution is missing or already terminal", async () => {
    const store = new MemoryStore();
    const task = okTask("t.ok");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await expect(service.processExecution("missing")).resolves.toBeUndefined();

    await store.saveExecution({
      ...pendingExecution({ taskId: task.id }),
      id: "done",
      status: "completed",
      result: "ok",
      completedAt: new Date(),
    });
    await expect(service.processExecution("done")).resolves.toBeUndefined();
  });

  it("returns early if lock cannot be acquired", async () => {
    const store = new MemoryStore();
    store.acquireLock = async () => null;
    const task = okTask("t.ok");

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await store.saveExecution(pendingExecution({ taskId: task.id }));

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("pending");
  });

  it("throws if processExecution runs without a taskExecutor", async () => {
    const store = new MemoryStore();
    const task = okTask("t.ok");
    const service = new DurableService({ store, tasks: [task] });

    await store.saveExecution(pendingExecution({ taskId: task.id }));

    await expect(service.processExecution("e1")).rejects.toThrow(
      "taskExecutor",
    );
  });

  it("times out waitForResult when queued but no worker runs", async () => {
    const store = new MemoryStore();
    const task = okTask("t.ok");

    const service = new DurableService({
      store,
      queue: new SpyQueue(),
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await expect(
      service.startAndWait(task, undefined, {
        timeout: 20,
        waitPollIntervalMs: 5,
      }),
    ).rejects.toBeInstanceOf(DurableExecutionError);
  });

  it("covers timeout and non-Error failure shapes", async () => {
    const store = new MemoryStore();
    const slow = r
      .task("t.slow")
      .run(
        async () =>
          await new Promise<string>((resolve) =>
            setTimeout(() => resolve("ok"), 25),
          ),
      )
      .build();
    const nonError = r
      .task("t.nonerror")
      .run(async () => {
        throw "boom";
      })
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [slow.id]: async () =>
          await new Promise<string>((resolve) =>
            setTimeout(() => resolve("ok"), 25),
          ),
        [nonError.id]: async () => {
          throw "boom";
        },
      }),
      tasks: [slow, nonError],
      execution: { maxAttempts: 1 },
    });

    await store.saveExecution({
      ...pendingExecution({ taskId: slow.id }),
      id: "timeout",
      timeout: 1,
    });
    await service.processExecution("timeout");
    expect((await store.getExecution("timeout"))?.status).toBe("failed");

    await store.saveExecution({
      ...pendingExecution({ taskId: nonError.id }),
      id: "nonerror",
      maxAttempts: 2,
    });
    await service.processExecution("nonerror");
    const updated = await store.getExecution("nonerror");
    expect(updated?.status).toBe("retrying");
    expect(updated?.error?.stack).toBeUndefined();
  });

  it("fails immediately when an execution timeout has already elapsed", async () => {
    const store = new MemoryStore();
    const task = okTask("t.fast");

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await store.saveExecution({
      ...pendingExecution({ taskId: task.id }),
      id: "elapsed",
      timeout: 1,
      createdAt: new Date(Date.now() - 10_000),
    });

    await service.processExecution("elapsed");
    const exec = await store.getExecution("elapsed");
    expect(exec?.status).toBe("failed");
    expect(exec?.error?.message).toContain("timed out");
  });

  it("covers no-lock stores and waitForResult missing execution", async () => {
    const store = new MemoryStore();
    const task = okTask("t.ok");

    const service = new DurableService({
      store: createBareStore(store),
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
    });

    await store.saveExecution(pendingExecution({ taskId: task.id }));
    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("completed");

    await expect(
      service.wait("missing", { timeout: 1, waitPollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(DurableExecutionError);
  });

  it("recovers incomplete executions", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const task = okTask("t.ok");

    const service = new DurableService({
      store,
      queue,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const base: Omit<Execution, "id" | "status"> = {
      taskId: task.id,
      input: undefined,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution({ ...base, id: "p", status: "pending" });
    await store.saveExecution({ ...base, id: "r", status: "running" });
    await store.saveExecution({ ...base, id: "s", status: "sleeping" });
    await store.saveExecution({ ...base, id: "x", status: "retrying" });
    await store.saveExecution({
      ...base,
      id: "c",
      status: "completed",
      result: "ok",
    });

    await service.recover();
    expect(queue.enqueued.length).toBe(4);
  });
});
