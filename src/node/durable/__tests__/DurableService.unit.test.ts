import { r } from "../../..";
import type { IDurableQueue, QueueMessage } from "../core/interfaces/queue";
import { SuspensionSignal } from "../core/interfaces/context";
import type { ITaskExecutor } from "../core/interfaces/service";
import type { MessageHandler } from "../core/interfaces/queue";
import type { IDurableStore } from "../core/interfaces/store";
import {
  DurableExecutionError,
  DurableService,
  disposeDurableService,
  initDurableService,
} from "../core/DurableService";
import type { Execution, Schedule, Timer } from "../core/types";
import { MemoryStore } from "../store/MemoryStore";

function createTaskExecutor(
  handlers: Record<string, (input: unknown) => Promise<unknown>>,
): ITaskExecutor {
  return {
    run: async (task, input) => {
      const handler = handlers[task.id];
      if (!handler) {
        throw new Error(`No task handler registered for: ${task.id}`);
      }
      return await handler(input);
    },
  };
}

class SpyQueue implements IDurableQueue {
  public enqueued: Array<Pick<QueueMessage, "type" | "payload">> = [];

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    this.enqueued.push({ type: message.type, payload: message.payload });
    return "id";
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

describe("durable: DurableService (unit)", () => {
  it("throws if execute is called without a taskExecutor", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store });

    const task = r
      .task("t")
      .run(async () => "ok")
      .build();

    await expect(service.execute(task)).rejects.toThrow("taskExecutor");
  });

  it("marks execution failed when task is not registered", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    const exec: Execution = {
      id: "e1",
      taskId: "missing",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(exec);

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("failed");
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

    const exec: Execution = {
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(exec);

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

  it("throws DurableExecutionError for failed executions via execute()", async () => {
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

    await expect(service.execute(task)).rejects.toBeInstanceOf(
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

    await expect(service.execute(task)).rejects.toBeInstanceOf(
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

    const exec: Execution = {
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(exec);

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("sleeping");
  });

  it("supports one-off and cron schedules", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sched")
      .run(async (_input: { a: number }) => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const onceId = await service.schedule(task, { a: 1 }, { delay: 5 });
    const readyOnce = await store.getReadyTimers(new Date(Date.now() + 1000));
    expect(readyOnce.some((t) => t.id === `once:${onceId}`)).toBe(true);

    const cronId = await service.schedule(
      task,
      { a: 1 },
      {
        id: "cron-1",
        cron: "*/5 * * * *",
      },
    );
    expect(cronId).toBe("cron-1");
    expect((await store.getSchedule("cron-1"))?.status).toBe("active");
  });

  it("supports schedule lifecycle helpers", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await service.pauseSchedule("missing");
    await service.resumeSchedule("missing");

    const schedule: Schedule = {
      id: "s1",
      taskId: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.createSchedule(schedule);

    await service.pauseSchedule("s1");
    expect((await store.getSchedule("s1"))?.status).toBe("paused");

    expect((await service.getSchedule("s1"))?.id).toBe("s1");
    expect((await service.listSchedules()).length).toBe(1);

    await service.resumeSchedule("s1");
    expect((await store.getSchedule("s1"))?.status).toBe("active");

    await service.updateSchedule("s1", { input: { a: 1 } });
    expect((await store.getSchedule("s1"))?.pattern).toBeUndefined();

    await service.removeSchedule("s1");
    expect(await store.getSchedule("s1")).toBeNull();
  });

  it("registers tasks provided via schedules config", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sched.task")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      schedules: [{ id: "s1", task, interval: 1000, input: {} }],
    });

    expect(service.findTask(task.id)).toBeDefined();
  });

  it("recovers incomplete executions", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();

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

  it("returns early if execution is missing or already terminal", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await expect(service.processExecution("missing")).resolves.toBeUndefined();

    await store.saveExecution({
      id: "done",
      taskId: task.id,
      input: undefined,
      status: "completed",
      result: "ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await expect(service.processExecution("done")).resolves.toBeUndefined();
  });

  it("returns early if lock cannot be acquired", async () => {
    const store = new MemoryStore();
    store.acquireLock = async () => null;
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await store.saveExecution({
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("pending");
  });

  it("throws if processExecution runs without a taskExecutor", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();
    const service = new DurableService({ store, tasks: [task] });

    await store.saveExecution({
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.processExecution("e1")).rejects.toThrow(
      "taskExecutor",
    );
  });

  it("times out waitForResult when queued but no worker runs", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      queue,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await expect(
      service.execute(task, undefined, { timeout: 20, waitPollIntervalMs: 5 }),
    ).rejects.toBeInstanceOf(DurableExecutionError);
  });

  it("creates interval-based schedules and updates intervals", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.interval")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const id = await service.schedule(task, undefined, {
      id: "s1",
      interval: 1000,
    });
    expect(id).toBe("s1");
    expect((await store.getSchedule("s1"))?.type).toBe("interval");

    await service.updateSchedule("s1", { interval: 2000 });
    expect((await store.getSchedule("s1"))?.pattern).toBe("2000");
  });

  it("supports scheduling at a fixed date", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.at")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const at = new Date(Date.now() + 1000);
    const id = await service.schedule(task, undefined, { id: "once-at", at });
    expect(id).toBe("once-at");

    const timers = await store.getReadyTimers(new Date(Date.now() + 2000));
    expect(timers.some((t) => t.id === "once:once-at")).toBe(true);
  });

  it("polls timers and handles schedule timers end-to-end", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.run")
      .run(async () => "ok")
      .build();

    const service = await initDurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
      polling: { interval: 5 },
    });

    const schedule: Schedule = {
      id: "s1",
      taskId: task.id,
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.createSchedule(schedule);

    const timer: Timer = {
      id: "sched:s1:now",
      scheduleId: "s1",
      taskId: task.id,
      input: undefined,
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    };
    await store.createTimer(timer);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const updatedSchedule = await store.getSchedule("s1");
    expect(updatedSchedule?.lastRun).toBeInstanceOf(Date);
    expect(updatedSchedule?.nextRun).toBeInstanceOf(Date);

    await service.stop();
  });

  it("enqueues resumes when a queue is configured", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();

    const service = await initDurableService({
      store,
      queue,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      type: "retry",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    await service.stop();
  });

  it("covers poll race: poll schedules after stop and exits early", async () => {
    let resolveFirst!: (timers: Timer[]) => void;
    let resolveFirstAssigned = false;

    class BlockingStore extends MemoryStore {
      private callCount = 0;

      override async getReadyTimers(now?: Date): Promise<Timer[]> {
        this.callCount += 1;
        if (this.callCount === 1) {
          return await new Promise<Timer[]>((resolve) => {
            resolveFirst = resolve;
            resolveFirstAssigned = true;
          });
        }

        throw new Error("getReadyTimers should not be called after stop");
      }
    }

    const store = new BlockingStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });

    service.start();

    await new Promise((resolve) => setTimeout(resolve, 1));
    await service.stop();

    if (!resolveFirstAssigned) {
      throw new Error("Expected getReadyTimers to have been called");
    }
    resolveFirst([]);

    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it("signals enqueue resume messages when a queue is configured", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.signal("e1", "paid", { paidAt: 1 });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("signal returns early for missing executions and terminal states", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await expect(service.signal("missing", "x", 1)).resolves.toBeUndefined();
    expect(queue.enqueued.length).toBe(0);

    await store.saveExecution({
      id: "done",
      taskId: "t",
      input: undefined,
      status: "completed",
      result: "ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await service.signal("done", "x", 1);

    await store.saveExecution({
      id: "failed",
      taskId: "t",
      input: undefined,
      status: "failed",
      error: { message: "err" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.signal("failed", "x", 1);

    expect(queue.enqueued.length).toBe(0);
  });

  it("signal returns early when the signal is already completed or timed out", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await service.signal("e1", "paid", { paidAt: 2 });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", "timed", { paidAt: 2 });

    expect(queue.enqueued.length).toBe(0);
  });

  it("signal does not overwrite completed or timed out signal steps", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed" },
      completedAt: new Date(),
    });
    await service.signal("e1", "paid", { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", "timed", { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      { state: "timed_out" },
    );
  });

  it("signal overwrites unknown signal step states", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "unknown" },
      completedAt: new Date(),
    });

    await service.signal("e1", "paid", { paidAt: 1 });
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("covers poll error handling and no-op timer branches", async () => {
    class ExplodingStore extends MemoryStore {
      public shouldThrow = false;
      override async getReadyTimers(now?: Date) {
        if (this.shouldThrow) {
          throw new Error("boom");
        }
        return super.getReadyTimers(now);
      }
    }

    const store = new ExplodingStore();
    const service = await initDurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });

    await store.createTimer({
      id: "no-taskid",
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await store.createTimer({
      id: "unknown-task",
      taskId: "missing",
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    store.shouldThrow = true;

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(consoleSpy).toHaveBeenCalledWith(
      "DurableService polling error:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();

    await service.stop();
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
      id: "timeout",
      taskId: slow.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      timeout: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.processExecution("timeout");
    expect((await store.getExecution("timeout"))?.status).toBe("failed");

    await store.saveExecution({
      id: "nonerror",
      taskId: nonError.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.processExecution("nonerror");
    const updated = await store.getExecution("nonerror");
    expect(updated?.status).toBe("retrying");
    expect(updated?.error?.stack).toBeUndefined();
  });

  it("fails immediately when an execution timeout has already elapsed", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.fast")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await store.saveExecution({
      id: "elapsed",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      timeout: 1,
      createdAt: new Date(Date.now() - 10_000),
      updatedAt: new Date(),
    });

    await service.processExecution("elapsed");
    const exec = await store.getExecution("elapsed");
    expect(exec?.status).toBe("failed");
    expect(exec?.error?.message).toContain("timed out");
  });

  it("covers no-lock stores and waitForResult missing execution", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.ok")
      .run(async () => "ok")
      .build();

    const noLockStore: IDurableStore = {
      saveExecution: store.saveExecution.bind(store),
      getExecution: store.getExecution.bind(store),
      updateExecution: store.updateExecution.bind(store),
      listIncompleteExecutions: store.listIncompleteExecutions.bind(store),
      getStepResult: store.getStepResult.bind(store),
      saveStepResult: store.saveStepResult.bind(store),
      createTimer: store.createTimer.bind(store),
      getReadyTimers: store.getReadyTimers.bind(store),
      markTimerFired: store.markTimerFired.bind(store),
      deleteTimer: store.deleteTimer.bind(store),
      createSchedule: store.createSchedule.bind(store),
      getSchedule: store.getSchedule.bind(store),
      updateSchedule: store.updateSchedule.bind(store),
      deleteSchedule: store.deleteSchedule.bind(store),
      listSchedules: store.listSchedules.bind(store),
      listActiveSchedules: store.listActiveSchedules.bind(store),
    };

    const service = new DurableService({
      store: noLockStore,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
    });

    await store.saveExecution({
      id: "e1",
      taskId: task.id,
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.processExecution("e1");
    expect((await store.getExecution("e1"))?.status).toBe("completed");

    await expect(
      service.wait("missing", { timeout: 1, waitPollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(DurableExecutionError);
  });

  it("initializes and disposes adapters via initDurableService/disposeDurableService", async () => {
    class StoreWithLifecycle extends MemoryStore {
      constructor(
        public readonly initFn: () => Promise<void>,
        public readonly disposeFn: () => Promise<void>,
      ) {
        super();
      }

      init(): Promise<void> {
        return this.initFn();
      }

      dispose(): Promise<void> {
        return this.disposeFn();
      }
    }

    const initStore = jest.fn(async () => {});
    const disposeStore = jest.fn(async () => {});
    const store = new StoreWithLifecycle(initStore, disposeStore);

    const queue: IDurableQueue = {
      enqueue: async () => "id",
      consume: async () => {},
      ack: async () => {},
      nack: async () => {},
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {}),
    };

    const eventBus = {
      publish: async () => {},
      subscribe: async () => {},
      unsubscribe: async () => {},
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {}),
    };

    const service = await initDurableService({
      store,
      queue,
      eventBus,
      taskExecutor: createTaskExecutor({}),
    });

    await disposeDurableService(service, {
      store,
      queue,
      eventBus,
      taskExecutor: createTaskExecutor({}),
    });

    expect(initStore).toHaveBeenCalled();
    expect(disposeStore).toHaveBeenCalled();
    expect(queue.init).toHaveBeenCalled();
    expect(queue.dispose).toHaveBeenCalled();
    expect(eventBus.init).toHaveBeenCalled();
    expect(eventBus.dispose).toHaveBeenCalled();
  });

  it("covers start idempotency and failed-without-error waitForResult", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });

    service.start();
    service.start();

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.wait("e1", { timeout: 5, waitPollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(DurableExecutionError);

    await service.stop();
  });
});
