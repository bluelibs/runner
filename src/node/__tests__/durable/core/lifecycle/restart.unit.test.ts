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
import {
  durableRestartRejectedError,
  inputSchemaValidationError,
} from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

type AnyTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

const task: AnyTask = {
  id: "durable-tests-restart",
} as any;

const schemaTask: AnyTask = {
  id: "durable-tests-restart-schema",
  inputSchema: {
    parse: (value: unknown) => {
      if (value !== "ok") {
        throw new Error("bad input");
      }
      return value;
    },
  },
} as any;

function createManager(params: {
  store: IDurableStore;
  taskExecutor?: ITaskExecutor;
  task?: AnyTask;
}): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(params.task ?? task);

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

describe("durable: restart execution", () => {
  it("restarts a completed execution as a fresh run with reused input", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        input: { v: 1 },
        attempt: 3,
        result: { v: 1 },
        current: {
          kind: "step",
          stepId: "s1",
          startedAt: new Date(),
        },
      }),
    );
    const seen: unknown[] = [];
    const run = jest.fn();
    run.mockImplementation(async (_task: unknown, input: unknown) => {
      seen.push(input);
      return input;
    });
    const manager = createManager({ store, taskExecutor: { run } });

    const restartedId = await manager.restartExecution("e-restart");

    expect(restartedId).not.toBe("e-restart");
    expect(seen).toEqual([{ v: 1 }]);
    const restarted = await store.getExecution(restartedId);
    expect(restarted?.status).toBe(ExecutionStatus.Completed);
    expect(restarted?.input).toEqual({ v: 1 });
    expect(restarted?.attempt).toBe(1);
    expect(restarted?.restartedFromExecutionId).toBe("e-restart");
    expect(restarted?.current).toBeUndefined();
    expect(restarted?.pausedAt).toBeUndefined();
    const source = await store.getExecution("e-restart");
    expect(source?.status).toBe(ExecutionStatus.Completed);
    expect(source?.restartedAsExecutionId).toBe(restartedId);
  });

  it.each([
    ExecutionStatus.Completed,
    ExecutionStatus.Failed,
    ExecutionStatus.CompensationFailed,
    ExecutionStatus.Cancelled,
    ExecutionStatus.ContinuedAsNew,
  ])("restarts a %s execution", async (status) => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ status }));
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const restartedId = await manager.restartExecution("e-restart");

    expect((await store.getExecution(restartedId))?.status).toBe(
      ExecutionStatus.Completed,
    );
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBe(restartedId);
  });

  it("restarts a paused execution and leaves the source paused", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        status: ExecutionStatus.Paused,
        pausedAt: new Date(),
        pausedFrom: ExecutionStatus.Running,
      }),
    );
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const restartedId = await manager.restartExecution("e-restart");

    const source = await store.getExecution("e-restart");
    expect(source?.status).toBe(ExecutionStatus.Paused);
    expect(source?.restartedAsExecutionId).toBe(restartedId);
    expect((await store.getExecution(restartedId))?.status).toBe(
      ExecutionStatus.Completed,
    );
  });

  it("restarts with an input override", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ input: { v: 1 } }));
    const seen: unknown[] = [];
    const run = jest.fn();
    run.mockImplementation(async (_task: unknown, input: unknown) => {
      seen.push(input);
      return input;
    });
    const manager = createManager({ store, taskExecutor: { run } });

    const restartedId = await manager.restartExecution("e-restart", {
      input: { v: 2 },
    });

    expect(seen).toEqual([{ v: 2 }]);
    expect((await store.getExecution(restartedId))?.input).toEqual({ v: 2 });
    expect((await store.getExecution("e-restart"))?.input).toEqual({ v: 1 });
  });

  it.each([
    ExecutionStatus.Pending,
    ExecutionStatus.Running,
    ExecutionStatus.Cancelling,
    ExecutionStatus.Retrying,
    ExecutionStatus.Sleeping,
  ])("rejects restart for %s executions", async (status) => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ status }));
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart")).rejects.toThrow(
      `Cannot restart execution "e-restart" with status "${status}".`,
    );
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBeUndefined();
  });

  it("rejects restart for missing executions", async () => {
    const manager = createManager({ store: new MemoryStore() });

    try {
      await manager.restartExecution("e-missing");
      throw new Error("expected restartExecution to throw");
    } catch (error) {
      expect(durableRestartRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot restart execution "e-missing" with status "unknown".',
      );
    }
  });

  it("validates input overrides against the registered task schema", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ workflowKey: schemaTask.id, input: "ok" }),
    );
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
      task: schemaTask,
    });

    try {
      await manager.restartExecution("e-restart", { input: "bad" });
      throw new Error("expected restartExecution to throw");
    } catch (error) {
      expect(inputSchemaValidationError.is(error)).toBe(true);
    }
    expect(await store.listExecutions()).toHaveLength(1);
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBeUndefined();
  });

  it("restarts without validation when the task is not registered here", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ workflowKey: "unregistered-workflow" }),
    );
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const restartedId = await manager.restartExecution("e-restart", {
      input: { v: 9 },
    });

    const restarted = await store.getExecution(restartedId);
    expect(restarted?.status).toBe(ExecutionStatus.Failed);
    expect(restarted?.error?.message).toContain("unregistered-workflow");
  });

  it("points the forward link at the latest restart", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("restarted-ok"),
    });

    const first = await manager.restartExecution("e-restart");
    const second = await manager.restartExecution("e-restart");

    expect(second).not.toBe(first);
    expect(
      (await store.getExecution("e-restart"))?.restartedAsExecutionId,
    ).toBe(second);
    expect((await store.getExecution(first))?.restartedFromExecutionId).toBe(
      "e-restart",
    );
  });
});
