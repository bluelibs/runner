import { event, r } from "../../..";
import type {
  IDurableQueue,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import type { ITaskExecutor } from "../../durable/core/interfaces/service";
import type { MessageHandler } from "../../durable/core/interfaces/queue";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import type { IEventBus } from "../../durable/core/interfaces/bus";
import {
  DurableExecutionError,
  DurableService,
  disposeDurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import { AuditLogger } from "../../durable/core/managers";
import type { DurableAuditEmitter } from "../../durable/core/audit";
import type { Execution, Schedule, Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

function createTaskExecutor(
  handlers: Record<string, (input: unknown) => Promise<any>>,
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
  const Paid = event<{ paidAt: number }>({ id: "paid" });
  const Timed = event<{ paidAt: number }>({ id: "timed" });
  const X = event<any>({ id: "x" });

  it("arms a kickoff failsafe timer and removes it after enqueue succeeds", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();

    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    const task = r
      .task("t.kickoff-failsafe.success")
      .run(async () => "ok")
      .build();

    await service.startExecution(task);

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers).toEqual([]);
  });

  it("keeps the kickoff failsafe timer when enqueue fails", async () => {
    class ThrowingQueue implements IDurableQueue {
      async enqueue(): Promise<string> {
        throw new Error("queue-down");
      }
      async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
      async ack(_messageId: string): Promise<void> {}
      async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
    }

    const store = new MemoryStore();
    const queue = new ThrowingQueue();

    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    const task = r
      .task("t.kickoff-failsafe.failure")
      .run(async () => "ok")
      .build();

    await expect(service.startExecution(task)).rejects.toThrow("queue-down");

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

    const task = r
      .task("t")
      .run(async () => "ok")
      .build();

    await expect(service.execute(task)).rejects.toThrow("taskExecutor");
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

    await expect(service.execute(task.id, { v: 3 })).resolves.toEqual({
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

    await expect(service.startExecution("missing.task.id")).rejects.toThrow(
      'DurableService.startExecution() could not resolve task id "missing.task.id"',
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

    const task = r
      .task("t.register")
      .run(async () => "ok")
      .build();

    serviceWithoutBus.registerTask(task);
    expect(serviceWithoutBus.findTask(task.id)).toBe(task);

    expect(serviceWithoutBus._pollingManager).toBeDefined();
    expect(serviceWithoutBus._executionManager).toBeDefined();
  });

  it("skips audit persistence when audit is enabled but the store does not support it", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const storeNoAudit: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
    };

    const service = new DurableService({
      store: storeNoAudit,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    const task = r
      .task("t.audit.no-store-support")
      .run(async () => "ok")
      .build();

    const executionId = await service.startExecution(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);

    await expect(base.listAuditEntries(executionId)).resolves.toEqual([]);
  });

  it("does not fail executions when audit persistence throws", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const storeThrowsAudit: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
      appendAuditEntry: async () => {
        throw new Error("audit-write-failed");
      },
    };

    const service = new DurableService({
      store: storeThrowsAudit,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    const task = r
      .task("t.audit.store-throws")
      .run(async () => "ok")
      .build();

    const executionId = await service.startExecution(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);
  });

  it("does not fail executions when audit emitter throws", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();

    const emitter: DurableAuditEmitter = {
      emit: async () => {
        throw new Error("audit-emitter-failed");
      },
    };

    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true, emitter },
      tasks: [],
    });

    const task = r
      .task("t.audit.emitter-throws")
      .run(async () => "ok")
      .build();

    const executionId = await service.startExecution(task);
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId } },
    ]);
  });

  it("swallows exceptions thrown while persisting audit entries", async () => {
    const base = new MemoryStore();

    const storeThrowsAudit: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
      appendAuditEntry: async () => {
        throw new Error("audit-write-failed");
      },
    };

    const auditLogger = new AuditLogger({ enabled: true }, storeThrowsAudit);

    await expect(
      auditLogger.log({
        kind: "execution_status_changed",
        executionId: "e1",
        attempt: 1,
        from: null,
        to: "pending",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows exceptions thrown by the audit emitter", async () => {
    const store = new MemoryStore();
    const emit = jest.fn(async () => {
      throw new Error("audit-emitter-failed");
    });

    const emitter: DurableAuditEmitter = { emit };
    const auditLogger = new AuditLogger({ enabled: true, emitter }, store);

    await expect(
      auditLogger.log({
        kind: "execution_status_changed",
        executionId: "e1",
        attempt: 1,
        from: null,
        to: "pending",
      }),
    ).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("executes typed tasks via executeStrict()", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.strict")
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

    await expect(service.executeStrict(task)).resolves.toBe("ok");
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

  it("processes executions even when the store does not implement locks", async () => {
    const base = new MemoryStore();

    const storeNoLocks: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
    };

    const task = r
      .task("t.no-lock-store")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store: storeNoLocks,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await base.saveExecution({
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
      .run(async (_input: unknown) => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      schedules: [{ id: "s1", task, interval: 1000, input: {} }],
    });

    expect(service.findTask(task.id)).toBeDefined();
  });

  it("resolves schedules that reference a task by string id", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sched.task.by-id")
      .run(async (_input: unknown) => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
      schedules: [{ id: "s1", task: task.id, interval: 1000, input: {} }],
    });

    expect(service.findTask(task.id)).toBe(task);
  });

  it("fails fast when schedules reference an unknown string task id", () => {
    const store = new MemoryStore();

    expect(
      () =>
        new DurableService({
          store,
          taskExecutor: createTaskExecutor({}),
          schedules: [
            { id: "s1", task: "missing.task", interval: 1000, input: {} },
          ],
        }),
    ).toThrow(
      'Cannot initialize durable schedule "s1": task "missing.task" is not registered.',
    );
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

  it("does not auto-start polling when polling.enabled is false", async () => {
    const store = new MemoryStore();
    const service = await initDurableService({
      store,
      polling: { enabled: false, interval: 1 },
    });

    await store.createTimer({
      id: "t1",
      type: "retry",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.id === "t1")).toBe(true);

    await service.stop();
  });

  it("uses the default polling interval when polling.interval is not provided", async () => {
    const store = new MemoryStore();
    const service = await initDurableService({ store });

    await new Promise((resolve) => setTimeout(resolve, 5));
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
    expect(((store as any).timers as Map<string, unknown>).has("t1")).toBe(
      false,
    );
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

  it("handles sleep timer branches directly", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      audit: { enabled: true },
      tasks: [],
    });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 3,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await (
      service as unknown as { handleTimer: (timer: Timer) => Promise<void> }
    ).handleTimer({
      id: "t1",
      type: "sleep",
      executionId: "e1",
      stepId: "sleep:1",
      fireAt: new Date(),
      status: "pending",
    });

    await (
      service as unknown as { handleTimer: (timer: Timer) => Promise<void> }
    ).handleTimer({
      id: "t2",
      type: "sleep",
      stepId: "sleep:missing",
      fireAt: new Date(),
      status: "pending",
    });

    await (
      service as unknown as { handleTimer: (timer: Timer) => Promise<void> }
    ).handleTimer({
      id: "t3-missing-execution",
      type: "sleep",
      executionId: "missing-execution",
      stepId: "sleep:missing-execution",
      fireAt: new Date(),
      status: "pending",
    });

    await (
      service as unknown as { handleTimer: (timer: Timer) => Promise<void> }
    ).handleTimer({
      id: "t4",
      type: "sleep",
      executionId: "e-missing",
      stepId: "sleep:missing-exec",
      fireAt: new Date(),
      status: "pending",
    });

    const audit = await store.listAuditEntries("e1");
    const missingAudit = await store.listAuditEntries("e-missing");
    expect(audit.some((entry) => entry.kind === "sleep_completed")).toBe(true);
    expect(missingAudit[0]?.attempt).toBe(0);
  });

  it("skips timers when claimTimer returns false", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      workerId: "worker-2",
      tasks: [],
    });

    const timer: Timer = {
      id: "t-claimed",
      type: "sleep",
      executionId: "exec-claimed",
      stepId: "sleep:1",
      fireAt: new Date(0),
      status: "pending",
    };

    await store.createTimer(timer);
    await store.claimTimer(timer.id, "worker-1", 60_000);

    await (
      service as unknown as { handleTimer: (timer: Timer) => Promise<void> }
    ).handleTimer(timer);

    const results = await store.getStepResult("exec-claimed", "sleep:1");
    expect(results).toBeNull();
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

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("signals work without listStepResults() support (fallback scan path)", async () => {
    const base = new MemoryStore();

    const storeNoList: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
    };

    const queue = new SpyQueue();
    const service = new DurableService({
      store: storeNoList,
      queue,
      tasks: [],
    });

    await storeNoList.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await storeNoList.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 42 });

    expect(
      (await storeNoList.getStepResult("e1", "__signal:paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 42 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("throws when signal() cannot acquire the signal lock", async () => {
    const base = new MemoryStore();

    const storeLocked: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
      listStepResults: base.listStepResults.bind(base),
      acquireLock: async () => null,
      releaseLock: async () => {},
    };

    const service = new DurableService({ store: storeLocked, tasks: [] });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "signal lock",
    );
  });

  it("accepts typed signal ids in signal()", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("delivers signals to waiting steps created with explicit step ids", async () => {
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
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 123 });

    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 123 },
    });
    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("prefers the base signal slot over custom step id waiters", async () => {
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
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("prefers numeric slots over custom step id waiters when no base slot is waiting", async () => {
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
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders numeric signal slots by ascending index", async () => {
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
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("keeps the current best waiter when later numeric slots are worse", async () => {
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

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid:1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid:1",
      },
      completedAt: new Date(1),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(2),
    });

    await service.signal("e1", Paid, { paidAt: 101 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 101 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders custom signal slots deterministically when no numeric slots exist", async () => {
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
      stepId: "__signal:bbb",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:aaa",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 6 });

    expect((await store.getStepResult("e1", "__signal:aaa"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 6 },
    });
    expect((await store.getStepResult("e1", "__signal:bbb"))?.result).toEqual(
      expect.objectContaining({ state: "waiting" }),
    );
  });

  it("cleans up signal timeout timers when delivering a waiting signal", async () => {
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

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid",
      executionId: "e1",
      stepId: "__signal:paid",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid",
      },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 3 });

    const timers = await store.getReadyTimers(new Date(0));
    expect(timers.some((t) => t.id === "signal_timeout:e1:__signal:paid")).toBe(
      false,
    );
  });

  it("ignores waiting signal steps with invalid timerId types", async () => {
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
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid", timerId: 123 },
      completedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 9 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 9 },
    });
  });

  it("records signal delivery but does not resume when the execution is missing", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("missing", Paid, { paidAt: 4 });

    expect(
      (await store.getStepResult("missing", "__signal:stable-paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 4 },
    });
    expect(queue.enqueued.length).toBe(0);
  });

  it("does not resume terminal executions when delivering via listStepResults()", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

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

    await store.saveStepResult({
      executionId: "done",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("done", Paid, { paidAt: 7 });

    expect(queue.enqueued.length).toBe(0);
    expect(
      (await store.getStepResult("done", "__signal:stable-paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 7 },
    });
  });

  it("processes executions directly when no queue is configured (signal resume)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.signal.process")
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
      id: "e1",
      taskId: task.id,
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
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 8 });

    expect((await store.getExecution("e1"))?.status).toBe("completed");
  });

  it("signals still work when the store does not implement listStepResults()", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const storeNoList: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
      claimTimer: base.claimTimer.bind(base),
    };

    const service = new DurableService({
      store: storeNoList,
      queue,
      tasks: [],
    });

    await base.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 5 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 5 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("signal returns early for missing executions and terminal states", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await expect(service.signal("missing", X, 1)).resolves.toBeUndefined();
    expect(queue.enqueued.length).toBe(0);
    expect(
      (await store.getStepResult("missing", "__signal:x"))?.result,
    ).toEqual({
      state: "completed",
      payload: 1,
    });

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
    await store.saveStepResult({
      executionId: "done",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("done", X, 1);

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
    await store.saveStepResult({
      executionId: "failed",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("failed", X, 1);

    expect(queue.enqueued.length).toBe(0);
  });

  it("signal records audit entries when audit is enabled", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      audit: { enabled: true },
    });

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

    await service.signal("e1", Paid, { paidAt: 1 });

    const entries = await store.listAuditEntries("e1");
    expect(entries.some((entry) => entry.kind === "signal_delivered")).toBe(
      true,
    );
  });

  it("signal audits missing executions with a default attempt", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      audit: { enabled: true },
    });

    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("missing", X, { ok: true });

    const entries = await store.listAuditEntries("missing");
    expect(entries[0]?.attempt).toBe(0);
    expect(entries[0]?.taskId).toBeUndefined();
  });

  it("signal buffers payload into the next slot when the base signal is already completed or timed out", async () => {
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
    await service.signal("e1", Paid, { paidAt: 2 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", Timed, { paidAt: 2 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      {
        state: "timed_out",
      },
    );
    expect(
      (await store.getStepResult("e1", "__signal:timed:1"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });

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
    await service.signal("e1", Paid, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", Timed, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      { state: "timed_out" },
    );
  });

  it("signal completes indexed waits and deletes any timeout timer", async () => {
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

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(Date.now() + 1000),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting", timerId: "t1" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.id === "t1")).toBe(false);
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("signal throws on invalid signal step state payloads", async () => {
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

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "unknown" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue.enqueued).toEqual([]);
  });

  it("signal throws if too many indexed signal slots exist", async () => {
    class InfiniteSignalStore extends MemoryStore {
      override async getStepResult(executionId: string, stepId: string) {
        if (stepId.startsWith("__signal:paid:")) {
          return {
            executionId,
            stepId,
            result: { state: "completed" },
            completedAt: new Date(),
          };
        }
        return await super.getStepResult(executionId, stepId);
      }
    }

    const store = new InfiniteSignalStore();
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

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "Too many signal slots",
    );
  });

  it("signal throws on invalid base signal payloads", async () => {
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
      result: { paidAt: 1 },
      completedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue.enqueued).toEqual([]);
  });

  it("signal throws on invalid base signal primitive payloads", async () => {
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
      result: 123,
      completedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 456 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue.enqueued).toEqual([]);
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

  it("initDurableService/disposeDurableService tolerate missing lifecycle hooks", async () => {
    const store = new MemoryStore();

    const service = await initDurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await expect(
      disposeDurableService(service, {
        store,
        taskExecutor: createTaskExecutor({}),
      }),
    ).resolves.toBeUndefined();
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
