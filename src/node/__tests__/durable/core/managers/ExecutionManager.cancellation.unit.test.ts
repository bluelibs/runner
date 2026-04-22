import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import {
  DURABLE_EXECUTION_CONTROL_CHANNEL,
  DurableExecutionControlEventType,
} from "../../../../durable/core/managers/ExecutionManager.cancellation";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type {
  IEventBus,
  BusEvent,
  BusEventHandler,
} from "../../../../durable/core/interfaces/bus";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import * as durableUtils from "../../../../durable/core/utils";
import { genericError } from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

enum TaskId {
  T = "durable-tests-executionManager-cancellation-t",
}

class TestEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<BusEventHandler>>();

  constructor(private readonly subscribeFailure?: Error) {}

  publish = jest.fn(async (channel: string, event: BusEvent): Promise<void> => {
    const handlers = Array.from(this.handlers.get(channel) ?? []);
    for (const handler of handlers) {
      await handler(event);
    }
  });

  subscribe = jest.fn(
    async (channel: string, handler: BusEventHandler): Promise<void> => {
      if (this.subscribeFailure) {
        throw this.subscribeFailure;
      }

      const handlers = this.handlers.get(channel) ?? new Set<BusEventHandler>();
      handlers.add(handler);
      this.handlers.set(channel, handlers);
    },
  );

  unsubscribe = jest.fn(
    async (channel: string, handler?: BusEventHandler): Promise<void> => {
      if (!handler) {
        this.handlers.delete(channel);
        return;
      }

      const handlers = this.handlers.get(channel);
      if (!handlers) {
        return;
      }

      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(channel);
      }
    },
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("durable: ExecutionManager cancellation", () => {
  const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
    id: TaskId.T,
  } as any;

  const createFixedTaskExecutor = <TValue>(value: TValue): ITaskExecutor => ({
    run: async <TResult>(): Promise<TResult> => value as unknown as TResult,
  });

  const createStore = (overrides: Partial<IDurableStore>): IDurableStore =>
    createBareStore(new MemoryStore(), overrides);

  const createManager = (params: {
    store: IDurableStore;
    eventBus?: IEventBus;
    taskExecutor?: ITaskExecutor;
  }) => {
    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);

    return new ExecutionManager(
      {
        store: params.store,
        eventBus: params.eventBus,
        taskExecutor: params.taskExecutor,
      },
      taskRegistry,
      new AuditLogger({ enabled: false }, params.store),
      new WaitManager(params.store, params.eventBus),
    );
  };

  const createExecution = (overrides: Partial<Execution> = {}): Execution => ({
    id: "e-test",
    workflowKey: TaskId.T,
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it("subscribes once and aborts only matching active attempts", async () => {
    const bus = new TestEventBus();
    const manager = createManager({
      store: createStore({ listIncompleteExecutions: async () => [] }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const matching = new AbortController();
    const other = new AbortController();
    (manager as any).activeAttemptControllers.set("e-match", matching);
    (manager as any).activeAttemptControllers.set("e-other", other);

    await manager.startLiveCancellationListener();
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: DurableExecutionControlEventType.CancellationRequested,
      payload: { executionId: "e-match", reason: "cancel-match" },
      timestamp: new Date(),
    });

    expect(bus.subscribe).toHaveBeenCalledTimes(1);
    expect(matching.signal.aborted).toBe(true);
    expect(matching.signal.reason).toBe("cancel-match");
    expect(other.signal.aborted).toBe(false);
  });

  it("ignores unrelated or malformed control events", async () => {
    const bus = new TestEventBus();
    const manager = createManager({
      store: createStore({ listIncompleteExecutions: async () => [] }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const controller = new AbortController();
    (manager as any).activeAttemptControllers.set("e-ignore", controller);

    await manager.startLiveCancellationListener();
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: "finished",
      payload: { executionId: "e-ignore", reason: "ignored" },
      timestamp: new Date(),
    });
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: DurableExecutionControlEventType.CancellationRequested,
      payload: { executionId: "e-ignore" },
      timestamp: new Date(),
    });

    expect(controller.signal.aborted).toBe(false);
  });

  it("unsubscribes the shared listener cleanly on stop", async () => {
    const bus = new TestEventBus();
    const manager = createManager({
      store: createStore({ listIncompleteExecutions: async () => [] }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const controller = new AbortController();
    (manager as any).activeAttemptControllers.set("e-stop", controller);

    await manager.startLiveCancellationListener();
    await manager.stopLiveCancellationListener();
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: DurableExecutionControlEventType.CancellationRequested,
      payload: { executionId: "e-stop", reason: "ignored-after-stop" },
      timestamp: new Date(),
    });

    expect(bus.unsubscribe).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(false);
  });

  it("publishes live cancellation for running executions", async () => {
    const bus = new TestEventBus();
    const store = createStore({ listIncompleteExecutions: async () => [] });
    await store.saveExecution(createExecution({ id: "e-running" }));
    const manager = createManager({ store, eventBus: bus });

    await manager.cancelExecution("e-running", "user-requested");

    expect(bus.publish).toHaveBeenCalledWith(
      DURABLE_EXECUTION_CONTROL_CHANNEL,
      expect.objectContaining({
        type: DurableExecutionControlEventType.CancellationRequested,
        payload: {
          executionId: "e-running",
          reason: "user-requested",
        },
      }),
    );
  });

  it("does not publish live cancellation for immediately terminal cancels", async () => {
    const bus = new TestEventBus();
    const store = createStore({ listIncompleteExecutions: async () => [] });
    await store.saveExecution(
      createExecution({
        id: "e-sleeping",
        status: ExecutionStatus.Sleeping,
      }),
    );
    const manager = createManager({ store, eventBus: bus });

    await manager.cancelExecution("e-sleeping", "cancel-sleeping");

    expect(bus.publish).not.toHaveBeenCalledWith(
      DURABLE_EXECUTION_CONTROL_CHANNEL,
      expect.objectContaining({
        type: DurableExecutionControlEventType.CancellationRequested,
      }),
    );
  });

  it("logs and continues when publishing live cancellation fails", async () => {
    const bus = new TestEventBus();
    bus.publish.mockRejectedValueOnce(
      genericError.new({ message: "publish-failed" }),
    );
    const store = createStore({ listIncompleteExecutions: async () => [] });
    await store.saveExecution(createExecution({ id: "e-publish-failure" }));
    const manager = createManager({ store, eventBus: bus });
    const warnSpy = jest
      .spyOn((manager as any).logger, "warn")
      .mockResolvedValue(undefined);

    await expect(
      manager.cancelExecution("e-publish-failure", "publish-cancel"),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "Durable live cancellation publish failed; relying on local abort or polling fallback.",
      expect.objectContaining({
        executionId: "e-publish-failure",
        error: expect.any(Error),
      }),
    );
  });

  it("rechecks the store once after registration when live cancellation is active", async () => {
    const bus = new TestEventBus();
    const deferred = createDeferred<Execution | null>();
    const getExecution = jest.fn(async () => await deferred.promise);
    const manager = createManager({
      store: createStore({
        getExecution,
        listIncompleteExecutions: async () => [],
      }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await manager.startLiveCancellationListener();
    const registrationPromise = (manager as any).registerAttemptCancellation({
      executionId: "e-race",
    });
    deferred.resolve(
      createExecution({
        id: "e-race",
        cancelRequestedAt: new Date(),
        error: { message: "race-cancelled" },
      }),
    );

    const registration = await registrationPromise;

    expect(getExecution).toHaveBeenCalledTimes(1);
    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe("race-cancelled");
    registration.stop();
  });

  it("does not start idle polling when live cancellation is active", async () => {
    const bus = new TestEventBus();
    let reads = 0;
    const manager = createManager({
      store: createStore({
        getExecution: async () => {
          reads += 1;
          return createExecution({ id: "e-live" });
        },
        listIncompleteExecutions: async () => [],
      }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await manager.startLiveCancellationListener();
    const registration = await (manager as any).registerAttemptCancellation({
      executionId: "e-live",
    });

    await durableUtils.sleepMs(300);

    expect(reads).toBe(1);
    registration.stop();
  });

  it("falls back to polling when the live recheck fails", async () => {
    const bus = new TestEventBus();
    let readCount = 0;
    let execution: Execution | null = createExecution({
      id: "e-recheck-fallback",
    });
    const manager = createManager({
      store: createStore({
        getExecution: async () => {
          readCount += 1;
          if (readCount === 1) {
            throw genericError.new({ message: "recheck-failed" });
          }

          return execution;
        },
        listIncompleteExecutions: async () => [],
      }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    const warnSpy = jest
      .spyOn((manager as any).logger, "warn")
      .mockResolvedValue(undefined);

    await manager.startLiveCancellationListener();
    const registration = await (manager as any).registerAttemptCancellation({
      executionId: "e-recheck-fallback",
    });
    execution = createExecution({
      id: "e-recheck-fallback",
      cancelRequestedAt: new Date(),
      error: { message: "cancelled-after-recheck-failure" },
    });

    await durableUtils.sleepMs(300);

    expect(warnSpy).toHaveBeenCalledWith(
      "Durable live cancellation recheck failed; falling back to per-attempt polling.",
      expect.objectContaining({
        executionId: "e-recheck-fallback",
        error: expect.any(Error),
      }),
    );
    expect(readCount).toBeGreaterThanOrEqual(2);
    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe("cancelled-after-recheck-failure");
    registration.stop();
  });

  it("skips polling fallback if the attempt is aborted during recheck warning", async () => {
    const bus = new TestEventBus();
    const manager = createManager({
      store: createStore({
        getExecution: async () => {
          throw genericError.new({ message: "recheck-failed" });
        },
        listIncompleteExecutions: async () => [],
      }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    const warnSpy = jest
      .spyOn((manager as any).logger, "warn")
      .mockImplementation(async () => {
        (manager as any).abortActiveAttempt(
          "e-recheck-aborted",
          "aborted-during-warn",
        );
      });
    const pollingSpy = jest.spyOn(
      manager as any,
      "startExecutionCancellationPollingFallback",
    );

    await manager.startLiveCancellationListener();
    const registration = await (manager as any).registerAttemptCancellation({
      executionId: "e-recheck-aborted",
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe("aborted-during-warn");
    expect(pollingSpy).not.toHaveBeenCalled();
    registration.stop();
  });

  it("does not let an older attempt cleanup delete a newer controller", async () => {
    const manager = createManager({
      store: createStore({
        getExecution: async () => null,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const firstRegistration = await (
      manager as any
    ).registerAttemptCancellation({
      executionId: "e-reused",
    });
    const secondRegistration = await (
      manager as any
    ).registerAttemptCancellation({
      executionId: "e-reused",
    });

    firstRegistration.stop();

    expect(
      (manager as any).activeAttemptControllers.get("e-reused"),
    ).toBeDefined();
    expect(
      (
        (manager as any).activeAttemptControllers.get(
          "e-reused",
        ) as AbortController
      ).signal,
    ).toBe(secondRegistration.signal);

    secondRegistration.stop();
    expect((manager as any).activeAttemptControllers.has("e-reused")).toBe(
      false,
    );
  });

  it("falls back to polling when no live event bus is configured", async () => {
    let execution: Execution | null = createExecution({ id: "e-poll" });
    const manager = createManager({
      store: createStore({
        getExecution: async () => execution,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const registration = await (manager as any).registerAttemptCancellation({
      executionId: "e-poll",
    });
    execution = createExecution({
      id: "e-poll",
      cancelRequestedAt: new Date(),
      error: { message: "poll-cancelled" },
    });

    await durableUtils.sleepMs(300);

    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe("poll-cancelled");
    registration.stop();
  });

  it("falls back to polling when live listener startup fails", async () => {
    const bus = new TestEventBus(
      genericError.new({ message: "subscribe-failed" }),
    );
    let execution: Execution | null = createExecution({ id: "e-fallback" });
    const manager = createManager({
      store: createStore({
        getExecution: async () => execution,
        listIncompleteExecutions: async () => [],
      }),
      eventBus: bus,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await manager.startLiveCancellationListener();
    const registration = await (manager as any).registerAttemptCancellation({
      executionId: "e-fallback",
    });
    execution = createExecution({
      id: "e-fallback",
      cancelRequestedAt: new Date(),
      error: { message: "fallback-cancelled" },
    });

    await durableUtils.sleepMs(300);

    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe("fallback-cancelled");
    registration.stop();
  });

  it("stops polling fallback cleanly when stopped or already aborted", async () => {
    const getExecution = jest.fn(async () => createExecution({ id: "e-stop" }));
    const manager = createManager({
      store: createStore({
        getExecution,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const stopWatcher = (
      manager as any
    ).startExecutionCancellationPollingFallback({
      executionId: "e-stop",
      controller: new AbortController(),
    });
    stopWatcher();

    await durableUtils.sleepMs(300);
    expect(getExecution).not.toHaveBeenCalled();

    const abortedController = new AbortController();
    abortedController.abort("done");
    const stopAbortedWatcher = (
      manager as any
    ).startExecutionCancellationPollingFallback({
      executionId: "e-stop-aborted",
      controller: abortedController,
    });

    await durableUtils.sleepMs(300);
    stopAbortedWatcher();
    expect(getExecution).not.toHaveBeenCalled();
  });

  it("swallows polling fallback store read failures", async () => {
    const manager = createManager({
      store: createStore({
        getExecution: async () => {
          throw genericError.new({ message: "watch-failed" });
        },
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    const controller = new AbortController();
    const stopWatcher = (
      manager as any
    ).startExecutionCancellationPollingFallback({
      executionId: "e-watch-failure",
      controller,
    });

    await durableUtils.sleepMs(300);
    stopWatcher();

    expect(controller.signal.aborted).toBe(false);
  });
});
