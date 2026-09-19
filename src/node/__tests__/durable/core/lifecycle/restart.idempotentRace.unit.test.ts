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
import { genericError } from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

type AnyTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

const task: AnyTask = {
  id: "durable-tests-restart-idempotent-race",
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

const fixedExecutor = (value: unknown): ITaskExecutor => ({
  run: async <TResult>(): Promise<TResult> => value as unknown as TResult,
});

function createSource(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-restart-idem",
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

describe("durable: idempotent restart races", () => {
  it("cancels a freshly claimed successor when the link loses its race", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createSource());
    const store = createBareStore(base, {
      createExecutionWithIdempotencyKey: async (params) => {
        const source = await base.getExecution("e-restart-idem");
        if (source) {
          await base.saveExecution({
            ...source,
            status: ExecutionStatus.Pending,
            pausedFrom: undefined,
          });
        }
        return base.createExecutionWithIdempotencyKey(params);
      },
    });
    const manager = createManager({
      store,
      taskExecutor: fixedExecutor("restarted-ok"),
    });

    await expect(
      manager.restartExecution("e-restart-idem", { idempotencyKey: "k1" }),
    ).rejects.toThrow(
      'Cannot restart execution "e-restart-idem" with status "pending".',
    );
    const source = await base.getExecution("e-restart-idem");
    expect(source?.status).toBe(ExecutionStatus.Pending);
    expect(source?.restartedAsExecutionId).toBeUndefined();
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-idem",
    );
    expect(successor?.status).toBe(ExecutionStatus.Cancelled);
  });

  it("leaves a previously claimed successor alone when a retry loses", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createSource());
    const manager = createManager({
      store: base,
      taskExecutor: fixedExecutor("restarted-ok"),
    });

    const first = await manager.restartExecution("e-restart-idem", {
      idempotencyKey: "k-retry",
    });
    const source = await base.getExecution("e-restart-idem");
    if (!source) throw new Error("expected source execution");
    await base.saveExecution({
      ...source,
      status: ExecutionStatus.Pending,
      pausedFrom: undefined,
    });

    let sourceReads = 0;
    const racingStore = createBareStore(base, {
      getExecution: async (id: string) => {
        const execution = await base.getExecution(id);
        if (id !== "e-restart-idem" || !execution) return execution;
        sourceReads += 1;
        return sourceReads === 1
          ? { ...execution, status: ExecutionStatus.Paused }
          : execution;
      },
    });
    const racingManager = createManager({
      store: racingStore,
      taskExecutor: fixedExecutor("restarted-ok"),
    });

    await expect(
      racingManager.restartExecution("e-restart-idem", {
        idempotencyKey: "k-retry",
      }),
    ).rejects.toThrow(
      'Cannot restart execution "e-restart-idem" with status "pending".',
    );
    expect((await base.getExecution(first))?.status).toBe(
      ExecutionStatus.Completed,
    );
    expect(
      (await base.getExecution("e-restart-idem"))?.restartedAsExecutionId,
    ).toBe(first);
  });

  it("rethrows link store failures without cancelling the claimed successor", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      createSource({ status: ExecutionStatus.Completed }),
    );
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (execution.restartedAsExecutionId) {
          throw genericError.new({ message: "link-store-down" });
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({ store });

    await expect(
      manager.restartExecution("e-restart-idem", { idempotencyKey: "k2" }),
    ).rejects.toThrow("link-store-down");
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-idem",
    );
    expect(successor?.status).toBe(ExecutionStatus.Pending);
  });

  it("follows the store-returned id when it differs from the minted one", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      createSource({ status: ExecutionStatus.Completed }),
    );
    const store = createBareStore(base, {
      createExecutionWithIdempotencyKey: async (params) => {
        await base.createExecutionWithIdempotencyKey(params);
        return { created: true, executionId: "aliased-successor" };
      },
    });
    const manager = createManager({
      store,
      taskExecutor: fixedExecutor("restarted-ok"),
    });

    const restartedId = await manager.restartExecution("e-restart-idem", {
      idempotencyKey: "k-alias",
    });

    expect(restartedId).toBe("aliased-successor");
    expect(
      (await base.getExecution("e-restart-idem"))?.restartedAsExecutionId,
    ).toBe("aliased-successor");
  });
});
