import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import {
  DURABLE_EXECUTION_CONTROL_CHANNEL,
  DurableExecutionControlEventType,
  EXECUTION_PAUSED_ABORT_REASON,
} from "../../../../durable/core/managers/ExecutionManager.cancellation";
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
import { durablePauseRejectedError } from "../../../../../errors";
import { genericError } from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
  id: "durable-tests-pause",
} as any;

class SpyBus implements IEventBus {
  publish = jest.fn(async (_channel: string, _event: BusEvent) => undefined);
  subscribe = jest.fn(
    async (_channel: string, _handler: BusEventHandler) => undefined,
  );
  unsubscribe = jest.fn(
    async (_channel: string, _handler?: BusEventHandler) => undefined,
  );
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
    id: "e-pause",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: pause execution", () => {
  it("pauses a pending execution and stays paused when paused again", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager({ store });

    await manager.pauseExecution("e-pause");
    await manager.pauseExecution("e-pause");

    const paused = await store.getExecution("e-pause");
    expect(paused?.status).toBe(ExecutionStatus.Paused);
    expect(paused?.pausedFrom).toBe(ExecutionStatus.Pending);
    expect(paused?.pausedAt).toBeInstanceOf(Date);
  });

  it("pauses a running execution, aborting the live attempt and publishing pause_requested", async () => {
    const bus = new SpyBus();
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Running }),
    );
    const manager = createManager({ store, eventBus: bus });

    const controller = new AbortController();
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-pause",
      controller,
    );

    await manager.pauseExecution("e-pause");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(EXECUTION_PAUSED_ABORT_REASON);
    expect(bus.publish).toHaveBeenCalledWith(
      DURABLE_EXECUTION_CONTROL_CHANNEL,
      expect.objectContaining({
        type: DurableExecutionControlEventType.PauseRequested,
        payload: {
          executionId: "e-pause",
          reason: EXECUTION_PAUSED_ABORT_REASON,
        },
      }),
    );
    const paused = await store.getExecution("e-pause");
    expect(paused?.status).toBe(ExecutionStatus.Paused);
    expect(paused?.pausedFrom).toBe(ExecutionStatus.Running);
  });

  it("pauses a sleeping execution without live publish and keeps its wait position", async () => {
    const bus = new SpyBus();
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        status: ExecutionStatus.Sleeping,
        current: {
          kind: "waitForSignal",
          stepId: "__signal:paid",
          startedAt: new Date(),
          waitingFor: {
            type: "signal",
            params: { signalId: "paid" },
          },
        },
      }),
    );
    const manager = createManager({ store, eventBus: bus });

    await manager.pauseExecution("e-pause");

    expect(bus.publish).not.toHaveBeenCalled();
    const paused = await store.getExecution("e-pause");
    expect(paused?.status).toBe(ExecutionStatus.Paused);
    expect(paused?.pausedFrom).toBe(ExecutionStatus.Sleeping);
    expect(paused?.current?.kind).toBe("waitForSignal");
  });

  it("pauses a retrying execution", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Retrying }),
    );
    const manager = createManager({ store });

    await manager.pauseExecution("e-pause");

    const paused = await store.getExecution("e-pause");
    expect(paused?.status).toBe(ExecutionStatus.Paused);
    expect(paused?.pausedFrom).toBe(ExecutionStatus.Retrying);
  });

  it.each([
    ExecutionStatus.Completed,
    ExecutionStatus.Failed,
    ExecutionStatus.CompensationFailed,
    ExecutionStatus.Cancelled,
    ExecutionStatus.ContinuedAsNew,
    ExecutionStatus.Cancelling,
  ])("rejects pause for %s executions", async (status) => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ status }));
    const manager = createManager({ store });

    await expect(manager.pauseExecution("e-pause")).rejects.toThrow(
      `Cannot pause execution "e-pause" with status "${status}".`,
    );
    expect((await store.getExecution("e-pause"))?.status).toBe(status);
  });

  it("rejects pause for missing executions", async () => {
    const manager = createManager({ store: new MemoryStore() });

    try {
      await manager.pauseExecution("e-missing");
      throw new Error("expected pauseExecution to throw");
    } catch (error) {
      expect(durablePauseRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot pause execution "e-missing" with status "unknown".',
      );
    }
  });

  it("retries pause on optimistic-concurrency conflicts", async () => {
    const backing = new MemoryStore();
    await backing.saveExecution(createExecution());
    let saves = 0;
    const store = createBareStore(backing, {
      saveExecutionIfStatus: async (execution, expected) => {
        saves += 1;
        if (saves === 1) {
          return false;
        }
        return await backing.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({ store });

    await manager.pauseExecution("e-pause");

    expect(saves).toBe(2);
    expect((await backing.getExecution("e-pause"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("re-aborts and re-publishes when pausing an already-paused running execution", async () => {
    const bus = new SpyBus();
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Running }),
    );
    const manager = createManager({ store, eventBus: bus });

    const first = new AbortController();
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-pause",
      first,
    );
    await manager.pauseExecution("e-pause");

    const second = new AbortController();
    (manager as any).cancellation.activeAttemptControllers.set(
      "e-pause",
      second,
    );
    await manager.pauseExecution("e-pause");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(second.signal.reason).toBe(EXECUTION_PAUSED_ABORT_REASON);
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect((await store.getExecution("e-pause"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("does not re-publish when pausing an already-paused pending execution", async () => {
    const bus = new SpyBus();
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager({ store, eventBus: bus });

    await manager.pauseExecution("e-pause");
    await manager.pauseExecution("e-pause");

    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("pauses even when live pause publish fails", async () => {
    const bus = new SpyBus();
    bus.publish.mockRejectedValueOnce(
      genericError.new({ message: "publish-failed" }),
    );
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Running }),
    );
    const manager = createManager({ store, eventBus: bus });
    const warnSpy = jest
      .spyOn((manager as any).logger, "warn")
      .mockResolvedValue(undefined);

    await expect(manager.pauseExecution("e-pause")).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "Durable live pause publish failed; relying on local abort or polling fallback.",
      expect.objectContaining({ executionId: "e-pause" }),
    );
    expect((await store.getExecution("e-pause"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });
});
