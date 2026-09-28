import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

type AnyTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

const task: AnyTask = {
  id: "durable-tests-restart-idempotent",
} as any;

function createManager(params: {
  store: IDurableStore;
  taskExecutor?: ITaskExecutor;
}): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(task);

  return new ExecutionManager(
    {
      store: params.store,
      eventBus: new NoopEventBus(),
      taskExecutor: params.taskExecutor,
    },
    taskRegistry,
    new AuditLogger({ enabled: false }, params.store),
    new WaitManager(params.store),
  );
}

function createFixedTaskExecutor<TValue>(value: TValue): ITaskExecutor {
  return {
    run: async <TResult>(): Promise<TResult> => value as unknown as TResult,
  };
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-restart",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: restart idempotency", () => {
  it("dedupes repeated restarts with the same idempotency key", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const run = jest.fn();
    run.mockImplementation(async () => "restarted-ok");
    const manager = createManager({ store, taskExecutor: { run } });

    const first = await manager.restartExecution("e-restart", {
      idempotencyKey: "restart-key",
    });
    const second = await manager.restartExecution("e-restart", {
      idempotencyKey: "restart-key",
    });

    expect(second).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBe(first);
  });

  it("re-kicks a still-pending execution on idempotent restart retry", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const pending: Execution = {
      id: "e-pending-restart",
      workflowKey: task.id,
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      restartedFromExecutionId: "e-restart",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.createExecutionWithIdempotencyKey({
      execution: pending,
      workflowKey: task.id,
      idempotencyKey: "restart-pending-key",
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const restartedId = await manager.restartExecution("e-restart", {
      idempotencyKey: "restart-pending-key",
    });

    expect(restartedId).toBe("e-pending-restart");
    expect((await store.getExecution(restartedId))?.status).toBe(
      ExecutionStatus.Completed,
    );
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBe(restartedId);
  });

  it("fails fast when the mapped execution is gone", async () => {
    const backing = new MemoryStore();
    await backing.saveExecution(createExecution());
    const store = createBareStore(backing, {
      createExecutionWithIdempotencyKey: async () => ({
        created: false as const,
        executionId: "e-ghost",
      }),
    });
    const manager = createManager({ store });

    await expect(
      manager.restartExecution("e-restart", {
        idempotencyKey: "restart-ghost-key",
      }),
    ).rejects.toThrow(
      'Idempotency mapping for restart of execution "e-restart" points to missing execution "e-ghost".',
    );
    expect(
      (await backing.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBeUndefined();
  });

  it("rejects a key that already maps to another source's restart", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ id: "e-source-a" }));
    await store.saveExecution(createExecution({ id: "e-source-b" }));
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const first = await manager.restartExecution("e-source-a", {
      idempotencyKey: "shared-key",
    });

    await expect(
      manager.restartExecution("e-source-b", { idempotencyKey: "shared-key" }),
    ).rejects.toThrow(
      `Cannot restart execution "e-source-b" with this idempotency key: it already maps to execution "${first}", which was restarted from a different source.`,
    );
    expect(
      (await store.getExecution("e-source-b"))?.restartedAsExecutionId,
    ).toBeUndefined();
    expect(
      (await store.getExecution("e-source-a"))?.restartedAsExecutionId,
    ).toBe(first);
  });
});
