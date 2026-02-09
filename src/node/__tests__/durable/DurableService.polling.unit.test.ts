import type { IDurableQueue } from "../../durable/core/interfaces/queue";
import {
  DurableExecutionError,
  DurableService,
  disposeDurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import type { Schedule, Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  SpyQueue,
  okTask,
  sleepingExecution,
} from "./DurableService.unit.helpers";

describe("durable: DurableService — polling & lifecycle (unit)", () => {
  it("polls timers and handles schedule timers end-to-end", async () => {
    const store = new MemoryStore();
    const task = okTask("t.run");

    const service = await initDurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
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

    await store.saveExecution(
      sleepingExecution({ attempt: 3, maxAttempts: 3 }),
    );

    const handleTimer = (
      service as unknown as {
        handleTimer: (timer: Timer) => Promise<void>;
      }
    ).handleTimer.bind(service);

    await handleTimer({
      id: "t1",
      type: "sleep",
      executionId: "e1",
      stepId: "sleep:1",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer({
      id: "t2",
      type: "sleep",
      stepId: "sleep:missing",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer({
      id: "t3-missing-execution",
      type: "sleep",
      executionId: "missing-execution",
      stepId: "sleep:missing-execution",
      fireAt: new Date(),
      status: "pending",
    });

    await handleTimer({
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

  it("initializes and disposes adapters via initDurableService/disposeDurableService", async () => {
    class StoreWithLifecycle extends MemoryStore {
      constructor(
        public readonly initFn: () => Promise<void>,
        public readonly disposeFn: () => Promise<void>,
      ) {
        super();
      }
      init() {
        return this.initFn();
      }
      dispose() {
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
