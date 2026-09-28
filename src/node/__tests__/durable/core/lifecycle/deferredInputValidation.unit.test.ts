import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { restartExecution } from "../../../../durable/core/managers/ExecutionManager.restart";
import { continueExecutionAsNew } from "../../../../durable/core/managers/ExecutionManager.continueAsNew";
import type { ExecutionPersistenceDeps } from "../../../../durable/core/managers/ExecutionManager.persistence";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

type AnyTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

const schemaTask: AnyTask = {
  id: "durable-tests-deferred-validation",
  inputSchema: {
    parse: (value: unknown) => {
      if (value !== "ok") {
        throw new Error("bad input");
      }
      return value;
    },
  },
} as any;

const schemalessTask: AnyTask = {
  id: "durable-tests-deferred-validation-schemaless",
} as any;

function createManager(params: {
  store: IDurableStore;
  task: AnyTask;
  taskExecutor?: ITaskExecutor;
}): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(params.task);

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

function createPersistence(store: MemoryStore): ExecutionPersistenceDeps {
  return {
    store,
    auditLogger: new AuditLogger({ enabled: false }, store),
    getTaskWorkflowKey: (task: AnyTask) => task.id,
    maxAttempts: 1,
    kickoffFailsafeDelayMs: 0,
    kickoffExecution: async () => {},
  };
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-deferred",
    workflowKey: schemaTask.id,
    input: undefined,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: deferred input validation", () => {
  it("flags restart overrides the local runtime cannot validate", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Completed }),
    );

    const restartedId = await restartExecution(
      {
        persistence: createPersistence(store),
        resolveTask: () => undefined,
      },
      "e-deferred",
      { input: "bad" },
    );

    const restarted = await store.getExecution(restartedId);
    expect(restarted?.input).toBe("bad");
    expect(restarted?.inputNeedsValidation).toBe(true);
  });

  it("leaves reused restart input unflagged", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Completed, input: "ok" }),
    );

    const restartedId = await restartExecution(
      {
        persistence: createPersistence(store),
        resolveTask: () => undefined,
      },
      "e-deferred",
    );

    expect(
      (await store.getExecution(restartedId))?.inputNeedsValidation,
    ).toBeUndefined();
  });

  it("leaves locally validated overrides unflagged", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Completed }),
    );

    const restartedId = await restartExecution(
      {
        persistence: createPersistence(store),
        resolveTask: () => schemaTask,
      },
      "e-deferred",
      { input: "ok" },
    );

    expect(
      (await store.getExecution(restartedId))?.inputNeedsValidation,
    ).toBeUndefined();
  });

  it("fails a flagged execution fast when its input is invalid", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ input: "bad", inputNeedsValidation: true }),
    );
    const run = jest.fn();
    run.mockImplementation(async () => "should-not-run");
    const manager = createManager({
      store,
      task: schemaTask,
      taskExecutor: { run },
    });

    await manager.processExecution("e-deferred");

    const execution = await store.getExecution("e-deferred");
    expect(execution?.status).toBe(ExecutionStatus.Failed);
    expect(execution?.error?.message).toContain("Task input validation failed");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs flagged input once it validates and clears the flag", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ input: "ok", inputNeedsValidation: true }),
    );
    const run = jest.fn();
    run.mockImplementation(async () => "ran-ok");
    const manager = createManager({
      store,
      task: schemaTask,
      taskExecutor: { run },
    });

    await manager.processExecution("e-deferred");

    const execution = await store.getExecution("e-deferred");
    expect(execution?.status).toBe(ExecutionStatus.Completed);
    expect(execution?.inputNeedsValidation).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clears the flag when no schema can validate the input", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        workflowKey: schemalessTask.id,
        input: { anything: true },
        inputNeedsValidation: true,
      }),
    );
    const run = jest.fn();
    run.mockImplementation(async () => "ran-ok");
    const manager = createManager({
      store,
      task: schemalessTask,
      taskExecutor: { run },
    });

    await manager.processExecution("e-deferred");

    const execution = await store.getExecution("e-deferred");
    expect(execution?.status).toBe(ExecutionStatus.Completed);
    expect(execution?.inputNeedsValidation).toBeUndefined();
  });

  it("flags continue-as-new successors for worker-side validation", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({ status: ExecutionStatus.Running }),
    );
    const running = (await store.getExecution("e-deferred"))!;

    await continueExecutionAsNew({
      deps: {
        persistence: createPersistence(store),
        notifyFinished: async () => {},
      },
      runningExecution: running,
      nextInput: { page: 2 },
      logStatusChange: async () => {},
      finalizeCancellation: async () => false,
    });

    const prior = await store.getExecution("e-deferred");
    const successor = await store.getExecution(
      prior?.continuedAsExecutionId ?? "",
    );
    expect(successor?.inputNeedsValidation).toBe(true);
  });
});
