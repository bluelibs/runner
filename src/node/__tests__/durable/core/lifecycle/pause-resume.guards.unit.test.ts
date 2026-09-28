import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import {
  DURABLE_EXECUTION_CONTROL_CHANNEL,
  DurableExecutionControlEventType,
  EXECUTION_PAUSED_ABORT_REASON,
} from "../../../../durable/core/managers/ExecutionManager.cancellation";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import { RecoveryManager } from "../../../../durable/core/managers/RecoveryManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../../../../durable/core/interfaces/bus";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import { sleepMs } from "../../../../durable/core/utils";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
  id: "durable-tests-pause-guards",
} as any;

class TestEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<BusEventHandler>>();

  publish = jest.fn(async (channel: string, event: BusEvent) => {
    for (const handler of Array.from(this.handlers.get(channel) ?? [])) {
      await handler(event);
    }
  });

  subscribe = jest.fn(async (channel: string, handler: BusEventHandler) => {
    const handlers = this.handlers.get(channel) ?? new Set<BusEventHandler>();
    handlers.add(handler);
    this.handlers.set(channel, handlers);
  });

  unsubscribe = jest.fn(async (channel: string, handler?: BusEventHandler) => {
    if (!handler) {
      this.handlers.delete(channel);
      return;
    }
    this.handlers.get(channel)?.delete(handler);
  });
}

function createManager(params: {
  store: IDurableStore;
  eventBus?: IEventBus;
  taskExecutor?: ITaskExecutor;
}): ExecutionManager {
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
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-guard",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Paused,
    attempt: 1,
    maxAttempts: 1,
    pausedAt: new Date(),
    pausedFrom: ExecutionStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: pause/resume guards", () => {
  it("ignores stale kicks for paused executions", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const run = jest.fn();
    run.mockImplementation(async () => "nope");
    const taskExecutor: ITaskExecutor = { run };
    const manager = createManager({ store, taskExecutor });

    await manager.processExecution("e-guard");

    expect(run).not.toHaveBeenCalled();
    expect((await store.getExecution("e-guard"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("ignores executions that pause after the pre-lock read", async () => {
    const running = createExecution({
      status: ExecutionStatus.Running,
      pausedAt: undefined,
      pausedFrom: undefined,
    });
    const paused = createExecution();
    const getExecution = jest.fn<Promise<Execution | null>, [string]>();
    getExecution.mockResolvedValueOnce(running);
    getExecution.mockResolvedValue(paused);
    const store = createBareStore(new MemoryStore(), { getExecution });
    const run = jest.fn();
    run.mockImplementation(async () => "nope");
    const taskExecutor: ITaskExecutor = { run };
    const manager = createManager({ store, taskExecutor });

    await manager.processExecution("e-guard");

    expect(run).not.toHaveBeenCalled();
  });

  it("never transitions a paused snapshot back to running", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager({ store });

    await expect(
      manager.attemptRunner.runExecutionAttempt(
        createExecution(),
        task,
        createExecutionLockState(),
      ),
    ).resolves.toBeUndefined();

    expect((await store.getExecution("e-guard"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("aborts matching attempts on live pause_requested events", async () => {
    const bus = new TestEventBus();
    const manager = createManager({ store: new MemoryStore(), eventBus: bus });

    const matching = new AbortController();
    const other = new AbortController();
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-match",
      matching,
    );
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-other",
      other,
    );

    await manager.startLiveCancellationListener();
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: DurableExecutionControlEventType.PauseRequested,
      payload: { executionId: "e-match", reason: "pause-match" },
      timestamp: new Date(),
    });

    expect(matching.signal.aborted).toBe(true);
    expect(matching.signal.reason).toBe("pause-match");
    expect(other.signal.aborted).toBe(false);

    await manager.stopLiveCancellationListener();
  });

  it("ignores malformed pause_requested events", async () => {
    const bus = new TestEventBus();
    const manager = createManager({ store: new MemoryStore(), eventBus: bus });

    const controller = new AbortController();
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-malformed",
      controller,
    );

    await manager.startLiveCancellationListener();
    await bus.publish(DURABLE_EXECUTION_CONTROL_CHANNEL, {
      type: DurableExecutionControlEventType.PauseRequested,
      payload: { executionId: "e-malformed" },
      timestamp: new Date(),
    });

    expect(controller.signal.aborted).toBe(false);

    await manager.stopLiveCancellationListener();
  });

  it("aborts paused attempts via the polling fallback", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        id: "e-poll",
        status: ExecutionStatus.Running,
        pausedAt: undefined,
        pausedFrom: undefined,
      }),
    );
    const manager = createManager({ store });
    const registration = await (
      manager as any
    ).cancellation.registerAttemptCancellation({ executionId: "e-poll" });

    await store.saveExecution(
      createExecution({
        id: "e-poll",
        status: ExecutionStatus.Paused,
        pausedFrom: ExecutionStatus.Running,
      }),
    );
    await sleepMs(350);

    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe(EXECUTION_PAUSED_ABORT_REASON);
    registration.stop();
  });

  it("aborts immediately when the live recheck finds a paused execution", async () => {
    const bus = new TestEventBus();
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ id: "e-recheck" }));
    const manager = createManager({ store, eventBus: bus });

    await manager.startLiveCancellationListener();
    const registration = await (
      manager as any
    ).cancellation.registerAttemptCancellation({ executionId: "e-recheck" });

    expect(registration.signal.aborted).toBe(true);
    expect(registration.signal.reason).toBe(EXECUTION_PAUSED_ABORT_REASON);
    registration.stop();

    await manager.stopLiveCancellationListener();
  });

  it("skips paused executions during recovery", async () => {
    const paused = createExecution({ id: "e-recover" });
    const store = createBareStore(new MemoryStore(), {
      listIncompleteExecutions: async () => [paused],
      acquireLock: jest.fn(async () => "lock-1"),
      releaseLock: jest.fn(async () => {}),
    });
    const recoverExecution = jest.fn(async () => {});
    const manager = new RecoveryManager(
      store as any,
      { recoverExecution } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const report = await manager.recover();

    expect(recoverExecution).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([
      {
        executionId: "e-recover",
        status: ExecutionStatus.Paused,
        reason: "not_recoverable",
      },
    ]);
  });
});
