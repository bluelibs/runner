import {
  DurableExecutionError,
  DurableService,
  disposeDurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import type { IDurableQueue } from "../../durable/core/interfaces/queue";
import type { Schedule, Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createTaskExecutor, okTask } from "./DurableService.unit.helpers";
import { genericError } from "../../../errors";

describe("durable: DurableService polling lifecycle (unit)", () => {
  it("stops registered worker consumers before finishing service shutdown", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const workerStop = jest.fn(async () => {});

    (
      service as unknown as {
        registerWorker: (worker: { stop: () => Promise<void> }) => void;
      }
    ).registerWorker({
      stop: workerStop,
    });

    await service.stop();

    expect(workerStop).toHaveBeenCalledTimes(1);
  });

  it("polls timers and handles schedule timers end-to-end", async () => {
    const store = new MemoryStore();
    const task = okTask("t-run");
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
    expect(timers.some((timer) => timer.id === "t1")).toBe(true);

    await service.stop();
  });

  it("uses the default polling interval when polling.interval is not provided", async () => {
    const store = new MemoryStore();
    const service = await initDurableService({ store });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.stop();
  });

  it("covers the stop race where polling exits before scheduling another wake-up", async () => {
    let resolveFirst!: (timers: Timer[]) => void;
    let didCallGetReadyTimers = false;

    class BlockingStore extends MemoryStore {
      private callCount = 0;

      override async getReadyTimers(_now?: Date): Promise<Timer[]> {
        this.callCount += 1;
        if (this.callCount === 1) {
          return await new Promise<Timer[]>((resolve) => {
            didCallGetReadyTimers = true;
            resolveFirst = resolve;
          });
        }

        throw genericError.new({
          message: "getReadyTimers should not be called after stop",
        });
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

    if (!didCallGetReadyTimers) {
      throw genericError.new({
        message: "Expected getReadyTimers to have been called",
      });
    }

    resolveFirst([]);
    await new Promise((resolve) => setTimeout(resolve, 25));
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

  it("tolerates missing lifecycle hooks on durable adapters", async () => {
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

  it("keeps start idempotent and surfaces failed executions without an error payload", async () => {
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
