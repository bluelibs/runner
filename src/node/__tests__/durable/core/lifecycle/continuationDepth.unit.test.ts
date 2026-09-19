import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { continueExecutionAsNew } from "../../../../durable/core/managers/ExecutionManager.continueAsNew";
import type { ExecutionPersistenceDeps } from "../../../../durable/core/managers/ExecutionManager.persistence";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task = { id: "durable-tests-continuation-depth" } as any;

function createPersistence(
  store: IDurableStore,
  maxContinuationDepth?: number,
): ExecutionPersistenceDeps {
  return {
    store,
    auditLogger: new AuditLogger({ enabled: false }, store),
    getTaskWorkflowKey: () => task.id,
    maxAttempts: 1,
    kickoffFailsafeDelayMs: 0,
    kickoffExecution: async () => {},
    maxContinuationDepth,
  };
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-depth",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function continueOnce(
  store: MemoryStore,
  runningId: string,
  maxContinuationDepth?: number,
): Promise<void> {
  const running = (await store.getExecution(runningId))!;
  await continueExecutionAsNew({
    deps: {
      persistence: createPersistence(store, maxContinuationDepth),
      notifyFinished: async () => {},
    },
    runningExecution: running,
    nextInput: { page: 2 },
    logStatusChange: async () => {},
    finalizeCancellation: async () => false,
  });
}

describe("durable: continuation depth bound", () => {
  it("assigns increasing depth to each successor", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());

    await continueOnce(store, "e-depth");
    const firstId = (await store.getExecution("e-depth"))
      ?.continuedAsExecutionId;
    expect(await store.getExecution(firstId ?? "")).toMatchObject({
      status: ExecutionStatus.Pending,
      continuationDepth: 1,
    });

    await store.updateExecution(firstId ?? "", {
      status: ExecutionStatus.Running,
    });
    await continueOnce(store, firstId ?? "");
    const root = await store.getExecution("e-depth");
    const secondId = (await store.getExecution(firstId ?? ""))
      ?.continuedAsExecutionId;
    expect(root?.continuationDepth).toBeUndefined();
    expect(await store.getExecution(secondId ?? "")).toMatchObject({
      continuationDepth: 2,
    });
  });

  it("fails the prior run when the depth limit is exceeded", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ continuationDepth: 1 }));

    await continueOnce(store, "e-depth", 1);

    const prior = await store.getExecution("e-depth");
    expect(prior?.status).toBe(ExecutionStatus.Failed);
    expect(prior?.error?.message).toContain("depth limit of 1 exceeded");
    expect(prior?.continuedAsExecutionId).toBeUndefined();
    expect(await store.listExecutions()).toHaveLength(1);
  });

  it("commits continuations exactly at the limit", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ continuationDepth: 1 }));

    await continueOnce(store, "e-depth", 2);

    const prior = await store.getExecution("e-depth");
    expect(prior?.status).toBe(ExecutionStatus.ContinuedAsNew);
    expect(
      await store.getExecution(prior?.continuedAsExecutionId ?? ""),
    ).toMatchObject({ continuationDepth: 2 });
  });

  it("treats a zero limit as disabled continuations", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());

    await continueOnce(store, "e-depth", 0);

    expect((await store.getExecution("e-depth"))?.status).toBe(
      ExecutionStatus.Failed,
    );
  });

  it("lets a racing operator decision win over the depth failure", async () => {
    const backing = new MemoryStore();
    await backing.saveExecution(
      createExecution({ status: ExecutionStatus.Paused }),
    );
    const store = createBareStore(backing, {
      getExecution: async (id: string) =>
        id === "e-depth"
          ? createExecution({ status: ExecutionStatus.Running })
          : backing.getExecution(id),
      saveExecutionIfStatus: async () => false,
      createContinuedExecution: backing.createContinuedExecution.bind(backing),
    });
    const finalizeCancellation = jest.fn(async () => false);

    await continueExecutionAsNew({
      deps: {
        persistence: createPersistence(store, 0),
        notifyFinished: async () => {},
      },
      runningExecution: createExecution({ status: ExecutionStatus.Running }),
      nextInput: { page: 2 },
      logStatusChange: async () => {},
      finalizeCancellation,
    });

    expect(finalizeCancellation).toHaveBeenCalled();
    expect((await backing.getExecution("e-depth"))?.status).toBe(
      ExecutionStatus.Paused,
    );
  });

  it("plumbs the configured limit into the persistence deps", async () => {
    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);
    const store = new MemoryStore();
    const manager = new ExecutionManager(
      {
        store,
        eventBus: new NoopEventBus(),
        execution: { maxContinuationDepth: 7 },
      },
      taskRegistry,
      new AuditLogger({ enabled: false }, store),
      new WaitManager(store),
    );

    expect((manager as any).persistenceDeps.maxContinuationDepth).toBe(7);

    const defaultManager = new ExecutionManager(
      { store, eventBus: new NoopEventBus() },
      taskRegistry,
      new AuditLogger({ enabled: false }, store),
      new WaitManager(store),
    );
    expect(
      (defaultManager as any).persistenceDeps.maxContinuationDepth,
    ).toBeUndefined();
  });
});
