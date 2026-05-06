import {
  DurableExecutionError,
  DurableService,
  disposeDurableService,
  initDurableService,
} from "../../../../durable/core/DurableService";
import { DurableWorker } from "../../../../durable/core/DurableWorker";
import type { IDurableQueue } from "../../../../durable/core/interfaces/queue";
import type { Schedule, Timer } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { waitUntil } from "../../../../durable/test-utils";
import { runtimeShutdownAbortReason } from "../../../../../tools/runtimeShutdownAbortReason";
import {
  createBareStore,
  createTaskExecutor,
  okTask,
} from "../../helpers/DurableService.unit.helpers";
import { genericError } from "../../../../../errors";
import { Logger } from "../../../../../models/Logger";

describe("durable: DurableService polling lifecycle (unit)", () => {
  function createSilentLogger(): Logger {
    return new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
  }

  it("runs cooldown handlers before final stop handlers and polling shutdown", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const callOrder: string[] = [];

    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        stopHandlers: Array<() => Promise<void>>;
        pollingManager: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        };
      }
    ).cooldownHandlers.push(async () => {
      callOrder.push("handler:cooldown");
    });
    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        stopHandlers: Array<() => Promise<void>>;
        pollingManager: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        };
      }
    ).stopHandlers.push(async () => {
      callOrder.push("handler:stop");
    });
    (
      service as unknown as {
        pollingManager: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        };
      }
    ).pollingManager.cooldown = jest.fn(async () => {
      callOrder.push("polling:cooldown");
    });
    (
      service as unknown as {
        pollingManager: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        };
      }
    ).pollingManager.stop = jest.fn(async () => {
      callOrder.push("polling:stop");
    });

    await service.stop();

    expect(callOrder).toEqual([
      "handler:cooldown",
      "polling:cooldown",
      "handler:stop",
      "polling:stop",
    ]);
  });

  it("treats repeated cooldown() calls as idempotent", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const cooldownHandler = jest.fn(async () => {});
    const pollingCooldown = jest.fn(async () => {});

    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).cooldownHandlers.push(cooldownHandler);
    (
      service as unknown as {
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).pollingManager.cooldown = pollingCooldown;

    await service.cooldown();
    await service.cooldown();

    expect(cooldownHandler).toHaveBeenCalledTimes(1);
    expect(pollingCooldown).toHaveBeenCalledTimes(1);
  });

  it("surfaces the first cooldown failure after draining cooldown handlers", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      logger: createSilentLogger(),
    });
    const firstCooldown = jest.fn(async () => {
      throw genericError.new({ message: "cooldown-handler-failed" });
    });
    const secondCooldown = jest.fn(async () => {});
    const pollingCooldown = jest.fn(async () => {
      throw genericError.new({ message: "polling-cooldown-failed" });
    });

    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).cooldownHandlers.push(firstCooldown, secondCooldown);
    (
      service as unknown as {
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).pollingManager.cooldown = pollingCooldown;

    await expect(service.cooldown()).rejects.toThrow("cooldown-handler-failed");
    expect(firstCooldown).toHaveBeenCalledTimes(1);
    expect(secondCooldown).toHaveBeenCalledTimes(1);
    expect(pollingCooldown).toHaveBeenCalledTimes(1);
  });

  it("surfaces polling cooldown failures when handlers succeeded", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      logger: createSilentLogger(),
    });
    const cooldownHandler = jest.fn(async () => {});
    const pollingCooldown = jest.fn(async () => {
      throw genericError.new({ message: "polling-cooldown-failed" });
    });

    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).cooldownHandlers.push(cooldownHandler);
    (
      service as unknown as {
        pollingManager: { cooldown: () => Promise<void> };
      }
    ).pollingManager.cooldown = pollingCooldown;

    await expect(service.cooldown()).rejects.toThrow("polling-cooldown-failed");
    expect(cooldownHandler).toHaveBeenCalledTimes(1);
    expect(pollingCooldown).toHaveBeenCalledTimes(1);
  });

  it("rejects new top-level durable starts once cooldown begins", async () => {
    const store = new MemoryStore();
    const task = okTask("t-cooldown-guard");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    await service.cooldown();

    expect(() => service.start(task)).toThrow("shutting down");
    await expect(service.startAndWait(task)).rejects.toThrow("shutting down");
  });

  it("rejects durable child starts during cooldown even when parentExecutionId is present", async () => {
    const store = new MemoryStore();
    const task = okTask("t-cooldown-continuation-start");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    await service.cooldown();

    expect(() =>
      service.start(task, undefined, { parentExecutionId: "parent-1" }),
    ).toThrow("shutting down");
  });

  it("rejects task-level durable signals during cooldown drain", async () => {
    const store = new MemoryStore();
    const task = okTask("t-cooldown-signal");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const signalHandler = (
      service as unknown as { signalHandler: { signal: jest.Mock } }
    ).signalHandler;
    signalHandler.signal = jest.fn(async () => undefined);

    await service.cooldown();

    await expect(
      service.signal("e1", { id: "sig" } as any, undefined),
    ).rejects.toThrow("shutting down");
    expect(signalHandler.signal).not.toHaveBeenCalled();
  });

  it("rejects task-level durable starts during disposing", async () => {
    const store = new MemoryStore();
    const task = okTask("t-disposing-task-start");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    (
      service as unknown as {
        lifecycleState: "running" | "cooldown" | "disposing" | "disposed";
      }
    ).lifecycleState = "disposing";

    expect(() => service.start(task)).toThrow("shutting down");
    await expect(service.startAndWait(task)).rejects.toThrow("shutting down");
  });

  it("rejects background durable admissions after cooldown begins", async () => {
    const store = new MemoryStore();
    const task = okTask("t-cooldown-background-guard");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    await service.cooldown();

    expect(() => service.start()).toThrow("shutting down");
    await expect(
      service.schedule(task, undefined, { interval: 10 }),
    ).rejects.toThrow("shutting down");
    await expect(
      service.ensureSchedule(task, undefined, { id: "s1", interval: 10 }),
    ).rejects.toThrow("shutting down");
    await expect(service.recover()).rejects.toThrow("shutting down");
  });

  it("rejects task-level durable interactions once shutdown has started", async () => {
    const store = new MemoryStore();
    const task = okTask("t-disposing-guard");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    await service.cooldown();
    (
      service as unknown as {
        lifecycleState: "running" | "cooldown" | "disposing" | "disposed";
      }
    ).lifecycleState = "disposing";

    expect(() => service.start(task)).toThrow("shutting down");
    await expect(service.startAndWait(task)).rejects.toThrow("shutting down");
    await expect(
      service.signal("e1", { id: "sig" } as any, undefined),
    ).rejects.toThrow("shutting down");

    (
      service as unknown as {
        lifecycleState: "running" | "cooldown" | "disposing" | "disposed";
      }
    ).lifecycleState = "disposed";

    expect(() => service.start(task)).toThrow("shutting down");
    await expect(service.startAndWait(task)).rejects.toThrow("shutting down");
    await expect(
      service.signal("e1", { id: "sig" } as any, undefined),
    ).rejects.toThrow("shutting down");
  });

  it("interrupts active attempts cooperatively during the shutdown abort window", async () => {
    const store = new MemoryStore();
    const task = okTask("t-shutdown-interrupt");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const controller = new AbortController();
    const abort = jest.spyOn(controller, "abort");
    (
      service._executionManager as unknown as {
        activeAttemptControllers: Map<string, AbortController>;
      }
    ).activeAttemptControllers.set("execution-1", controller);

    service.interruptActiveAttempts("shutdown");
    service.interruptActiveAttempts("shutdown");

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("shutdown");
  });

  it("uses the default shutdown reason when interrupting active attempts", async () => {
    const store = new MemoryStore();
    const task = okTask("t-shutdown-interrupt-default-reason");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const controller = new AbortController();
    const abort = jest.spyOn(controller, "abort");
    (
      service._executionManager as unknown as {
        activeAttemptControllers: Map<string, AbortController>;
      }
    ).activeAttemptControllers.set("execution-1", controller);

    service.interruptActiveAttempts();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith(runtimeShutdownAbortReason);
  });

  it("skips already-aborted attempts during shutdown interruption fan-out", async () => {
    const store = new MemoryStore();
    const task = okTask("t-shutdown-interrupt-skips-aborted");
    const service = await initDurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const controller = new AbortController();
    const abort = jest.spyOn(controller, "abort");
    controller.abort("already-aborted");

    (
      service._executionManager as unknown as {
        activeAttemptControllers: Map<string, AbortController>;
      }
    ).activeAttemptControllers.set("execution-1", controller);

    service.interruptActiveAttempts("shutdown");

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("already-aborted");
  });

  it("stops registered worker consumers before finishing service shutdown", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const workerCooldown = jest.fn(async () => {});
    const workerStop = jest.fn(async () => {});

    (
      service as unknown as {
        registerWorker: (worker: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        }) => void;
      }
    ).registerWorker({
      cooldown: workerCooldown,
      stop: workerStop,
    });

    await service.stop();

    expect(workerCooldown).toHaveBeenCalledTimes(1);
    expect(workerStop).toHaveBeenCalledTimes(1);
  });

  it("runs worker cooldown during service cooldown", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const workerCooldown = jest.fn(async () => {});
    const workerStop = jest.fn(async () => {});

    (
      service as unknown as {
        registerWorker: (worker: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        }) => void;
      }
    ).registerWorker({
      cooldown: workerCooldown,
      stop: workerStop,
    });

    await service.cooldown();

    expect(workerCooldown).toHaveBeenCalledTimes(1);
    expect(workerStop).not.toHaveBeenCalled();
  });

  it("treats repeated stop() calls after disposal as a no-op", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const pollingStop = jest.fn(async () => {});

    (
      service as unknown as {
        pollingManager: { stop: () => Promise<void> };
      }
    ).pollingManager.stop = pollingStop;

    await service.stop();
    await service.stop();

    expect(pollingStop).toHaveBeenCalledTimes(1);
  });

  it("drains shutdown handlers before surfacing the first stop failure", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const firstWorkerCooldown = jest.fn(async () => {});
    const secondWorkerCooldown = jest.fn(async () => {});
    const firstWorkerStop = jest.fn(async () => {
      throw genericError.new({ message: "worker-stop-failed" });
    });
    const secondWorkerStop = jest.fn(async () => {});
    const pollingStop = jest.fn(async () => {});
    (
      service as unknown as {
        pollingManager: { stop: () => Promise<void> };
      }
    ).pollingManager.stop = pollingStop;

    (
      service as unknown as {
        registerWorker: (worker: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        }) => void;
      }
    ).registerWorker({
      cooldown: firstWorkerCooldown,
      stop: firstWorkerStop,
    });
    (
      service as unknown as {
        registerWorker: (worker: {
          cooldown: () => Promise<void>;
          stop: () => Promise<void>;
        }) => void;
      }
    ).registerWorker({
      cooldown: secondWorkerCooldown,
      stop: secondWorkerStop,
    });

    await expect(service.stop()).rejects.toThrow("worker-stop-failed");

    expect(firstWorkerCooldown).toHaveBeenCalledTimes(1);
    expect(secondWorkerCooldown).toHaveBeenCalledTimes(1);
    expect(firstWorkerStop).toHaveBeenCalledTimes(1);
    expect(secondWorkerStop).toHaveBeenCalledTimes(1);
    expect(pollingStop).toHaveBeenCalledTimes(1);
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
      workflowKey: task.id,
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
      workflowKey: task.id,
      input: undefined,
      type: "scheduled",
      fireAt: new Date(Date.now() - 10),
      status: "pending",
    };
    await store.createTimer(timer);

    await waitUntil(
      async () => (await store.getSchedule("s1"))?.nextRun instanceof Date,
      { timeoutMs: 250, intervalMs: 1 },
    );

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

    await waitUntil(
      async () =>
        (await store.getReadyTimers(new Date(Date.now() + 60_000))).some(
          (timer) => timer.id === "t1",
        ),
      { timeoutMs: 250, intervalMs: 1 },
    );

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((timer) => timer.id === "t1")).toBe(true);

    await service.stop();
  });

  it("fails service startup when polling is enabled without claim-ready support", async () => {
    const store = createBareStore(new MemoryStore());
    Object.defineProperty(store, "claimReadyTimers", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(
      initDurableService({
        store,
        taskExecutor: createTaskExecutor({}),
        polling: { interval: 1 },
      }),
    ).rejects.toThrow("store.claimReadyTimers()");
  });

  it("uses the default polling interval when polling.interval is not provided", async () => {
    const store = new MemoryStore();
    const service = await initDurableService({ store });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.stop();
  });

  it("covers the stop race where polling exits before scheduling another wake-up", async () => {
    let resolveFirst!: (timers: Timer[]) => void;
    let markFirstPollReached!: () => void;
    const firstPollReached = new Promise<void>((resolve) => {
      markFirstPollReached = resolve;
    });

    class BlockingStore extends MemoryStore {
      private callCount = 0;

      override async claimReadyTimers(
        _now: Date,
        _limit: number,
        _workerId: string,
        _ttlMs: number,
      ): Promise<Timer[]> {
        this.callCount += 1;
        if (this.callCount === 1) {
          return await new Promise<Timer[]>((resolve) => {
            markFirstPollReached();
            resolveFirst = resolve;
          });
        }

        throw genericError.new({
          message: "claimReadyTimers should not be called after stop",
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
    await firstPollReached;
    await service.stop();

    resolveFirst([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  });

  it("waits for in-flight timer handling during service stop", async () => {
    let resolveTimer!: () => void;
    const timerBlocked = new Promise<void>((resolve) => {
      resolveTimer = resolve;
    });
    let markTimerStarted!: () => void;
    const timerStarted = new Promise<void>((resolve) => {
      markTimerStarted = resolve;
    });
    class BlockingStore extends MemoryStore {
      private delivered = false;

      override async claimReadyTimers(
        _now: Date,
        _limit: number,
        _workerId: string,
        _ttlMs: number,
      ): Promise<Timer[]> {
        if (this.delivered) {
          return [];
        }

        this.delivered = true;
        markTimerStarted();
        return [
          {
            id: "t-blocked",
            type: "retry",
            fireAt: new Date(Date.now() - 10),
            status: "pending",
          } as Timer,
        ];
      }
    }

    const store = new BlockingStore();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 5 },
    });
    const originalHandleClaimedTimer = (
      service as unknown as {
        pollingManager: { handleClaimedTimer: (timer: Timer) => Promise<void> };
      }
    ).pollingManager.handleClaimedTimer.bind(
      (
        service as unknown as {
          pollingManager: {
            handleClaimedTimer: (timer: Timer) => Promise<void>;
          };
        }
      ).pollingManager,
    );
    (
      service as unknown as {
        pollingManager: {
          handleClaimedTimer: (timer: Timer) => Promise<void>;
        };
      }
    ).pollingManager.handleClaimedTimer = jest.fn(async (timer: Timer) => {
      await timerBlocked;
      await originalHandleClaimedTimer(timer);
    });

    service.start();
    await timerStarted;
    await Promise.resolve();

    let stopped = false;
    const stopPromise = service.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    resolveTimer();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it("caps polling concurrency and refills slots as claimed timers finish", async () => {
    const store = new MemoryStore();
    const now = Date.now();

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      type: "retry",
      fireAt: new Date(now - 30),
      status: "pending",
    });
    await store.createTimer({
      id: "t2",
      executionId: "e2",
      type: "retry",
      fireAt: new Date(now - 20),
      status: "pending",
    });
    await store.createTimer({
      id: "t3",
      executionId: "e3",
      type: "retry",
      fireAt: new Date(now - 10),
      status: "pending",
    });

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      polling: { interval: 1000, concurrency: 2 },
    });
    const pollingManager = (
      service as unknown as {
        pollingManager: { handleClaimedTimer: (timer: Timer) => Promise<void> };
      }
    ).pollingManager;
    const originalHandleClaimedTimer =
      pollingManager.handleClaimedTimer.bind(pollingManager);
    const releaseByTimerId = new Map<string, () => void>();
    let activeHandlers = 0;
    let maxActiveHandlers = 0;

    pollingManager.handleClaimedTimer = jest.fn(async (timer: Timer) => {
      activeHandlers += 1;
      maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);

      await new Promise<void>((resolve) => {
        releaseByTimerId.set(timer.id, resolve);
      });

      activeHandlers -= 1;
      releaseByTimerId.delete(timer.id);
      await originalHandleClaimedTimer(timer);
    });

    service.start();

    await waitUntil(() => activeHandlers === 2, {
      timeoutMs: 250,
      intervalMs: 1,
    });
    expect(maxActiveHandlers).toBe(2);
    expect(Array.from(releaseByTimerId.keys()).sort()).toEqual(["t1", "t2"]);

    releaseByTimerId.get("t1")!();

    await waitUntil(() => activeHandlers === 2 && releaseByTimerId.has("t3"), {
      timeoutMs: 250,
      intervalMs: 1,
    });
    expect(maxActiveHandlers).toBe(2);

    releaseByTimerId.get("t2")!();
    releaseByTimerId.get("t3")!();

    await service.stop();
  });

  it("coalesces concurrent stop() calls into a single shutdown pass", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    const worker = new DurableWorker(
      {
        processExecution: jest.fn(async () => undefined),
        failExecutionDeliveryExhausted: jest.fn(async () => undefined),
      },
      {
        enqueue: jest.fn(async () => "m1"),
        consume: jest.fn(async () => undefined),
        ack: jest.fn(async () => undefined),
        nack: jest.fn(async () => undefined),
      },
    );
    jest.spyOn(worker, "cooldown").mockResolvedValue(undefined);
    jest.spyOn(worker, "stop").mockResolvedValue(undefined);
    service.registerWorker(worker);

    await Promise.all([service.stop(), service.stop()]);

    expect(worker.cooldown).toHaveBeenCalledTimes(1);
    expect(worker.stop).toHaveBeenCalledTimes(1);
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
      workflowKey: "t",
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
