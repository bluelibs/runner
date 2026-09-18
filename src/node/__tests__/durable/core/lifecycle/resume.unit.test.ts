import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import {
  ExecutionStatus,
  type DurableExecutionCurrent,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import { durableResumeRejectedError } from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
  id: "durable-tests-resume",
} as any;

const createFixedTaskExecutor = <TValue>(value: TValue): ITaskExecutor => ({
  run: async <TResult>(): Promise<TResult> => value as unknown as TResult,
});

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

function createPausedExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-resume",
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

describe("durable: resume execution", () => {
  it.each([
    ExecutionStatus.Pending,
    ExecutionStatus.Running,
    ExecutionStatus.Retrying,
    ExecutionStatus.Sleeping,
  ])("resumes a %s execution and re-kicks it", async (pausedFrom) => {
    const store = new MemoryStore();
    await store.saveExecution(createPausedExecution({ pausedFrom }));
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("resumed-ok"),
    });

    await manager.resumeExecution("e-resume");

    const resumed = await store.getExecution("e-resume");
    expect(resumed?.status).toBe(ExecutionStatus.Completed);
    expect(resumed?.result).toBe("resumed-ok");
    expect(resumed?.pausedFrom).toBeUndefined();
    expect(resumed?.pausedAt).toBeInstanceOf(Date);
  });

  it("rejects resume for missing executions", async () => {
    const manager = createManager({ store: new MemoryStore() });

    try {
      await manager.resumeExecution("e-missing");
      throw new Error("expected resumeExecution to throw");
    } catch (error) {
      expect(durableResumeRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot resume execution "e-missing" with status "unknown": it is not paused.',
      );
    }
  });

  it.each([
    ExecutionStatus.Pending,
    ExecutionStatus.Running,
    ExecutionStatus.Sleeping,
    ExecutionStatus.Completed,
    ExecutionStatus.Cancelled,
  ])("rejects resume for %s executions", async (status) => {
    const store = new MemoryStore();
    await store.saveExecution(
      createPausedExecution({ status, pausedFrom: undefined }),
    );
    const manager = createManager({ store });

    await expect(manager.resumeExecution("e-resume")).rejects.toThrow(
      `Cannot resume execution "e-resume" with status "${status}": it is not paused.`,
    );
    expect((await store.getExecution("e-resume"))?.status).toBe(status);
  });

  it.each([
    [
      "sleep",
      {
        kind: "sleep",
        stepId: "__sleep:0",
        startedAt: new Date(),
        waitingFor: {
          type: "sleep",
          params: { fireAtMs: Date.now() + 60_000, timerId: "t1" },
        },
      } satisfies DurableExecutionCurrent,
    ],
    [
      "waitForSignal",
      {
        kind: "waitForSignal",
        stepId: "__signal:paid",
        startedAt: new Date(),
        waitingFor: { type: "signal", params: { signalId: "paid" } },
      } satisfies DurableExecutionCurrent,
    ],
    [
      "waitForExecution",
      {
        kind: "waitForExecution",
        stepId: "__wait:child",
        startedAt: new Date(),
        waitingFor: {
          type: "execution",
          params: { targetExecutionId: "e-child", targetWorkflowKey: "child" },
        },
      } satisfies DurableExecutionCurrent,
    ],
  ])(
    "restores sleeping when pause origin is unknown but %s was waiting",
    async (_kind, current) => {
      const backing = new MemoryStore();
      await backing.saveExecution(
        createPausedExecution({ pausedFrom: undefined, current }),
      );
      const restored: ExecutionStatus[] = [];
      const store = createBareStore(backing, {
        saveExecutionIfStatus: async (execution, expected) => {
          if (expected.includes(ExecutionStatus.Paused)) {
            restored.push(execution.status);
          }
          return await backing.saveExecutionIfStatus(execution, expected);
        },
      });
      const manager = createManager({
        store,
        taskExecutor: createFixedTaskExecutor("resumed-ok"),
      });

      await manager.resumeExecution("e-resume");

      expect(restored).toEqual([ExecutionStatus.Sleeping]);
    },
  );

  it("restores pending when pause origin is unknown and nothing was waiting", async () => {
    const backing = new MemoryStore();
    await backing.saveExecution(
      createPausedExecution({ pausedFrom: undefined, current: undefined }),
    );
    const restored: ExecutionStatus[] = [];
    const store = createBareStore(backing, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (expected.includes(ExecutionStatus.Paused)) {
          restored.push(execution.status);
        }
        return await backing.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("resumed-ok"),
    });

    await manager.resumeExecution("e-resume");

    expect(restored).toEqual([ExecutionStatus.Pending]);
  });
});
