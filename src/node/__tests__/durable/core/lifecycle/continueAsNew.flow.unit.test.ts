import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { continueExecutionAsNew } from "../../../../durable/core/managers/ExecutionManager.continueAsNew";
import type { ExecutionContinueAsNewDeps } from "../../../../durable/core/managers/ExecutionManager.continueAsNew";
import type { ExecutionPersistenceDeps } from "../../../../durable/core/managers/ExecutionManager.persistence";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

function runningExecution(): Execution {
  return {
    id: "root",
    workflowKey: "continue-task",
    parentExecutionId: "parent",
    input: { orderId: "o1" },
    status: ExecutionStatus.Running,
    current: {
      kind: "step",
      stepId: "step-1",
      startedAt: new Date(),
    },
    attempt: 2,
    maxAttempts: 3,
    timeout: 5000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createDeps(
  store: IDurableStore,
  overrides: Partial<ExecutionPersistenceDeps> = {},
): {
  deps: ExecutionContinueAsNewDeps;
  kickoffExecution: jest.Mock;
  notifyFinished: jest.Mock;
} {
  const kickoffExecution = jest.fn(async () => undefined);
  const notifyFinished = jest.fn(async () => undefined);
  return {
    deps: {
      persistence: {
        store,
        auditLogger: new AuditLogger({}, store),
        getTaskWorkflowKey: () => "continue-task",
        maxAttempts: 3,
        kickoffFailsafeDelayMs: 0,
        kickoffExecution,
        ...overrides,
      },
      notifyFinished,
    },
    kickoffExecution,
    notifyFinished,
  };
}

function createCallbacks() {
  return {
    logStatusChange: jest.fn(async () => undefined),
    finalizeCancellation: jest.fn(async () => false),
  };
}

describe("durable: continueExecutionAsNew", () => {
  it("closes the prior run and kicks off its successor", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    const { deps, kickoffExecution, notifyFinished } = createDeps(store);
    const callbacks = createCallbacks();

    await continueExecutionAsNew({
      deps,
      runningExecution: runningExecution(),
      nextInput: { orderId: "o2" },
      ...callbacks,
    });

    const prior = await store.getExecution("root");
    expect(prior).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.ContinuedAsNew,
        current: undefined,
        completedAt: expect.any(Date),
      }),
    );
    expect(prior?.continuedAsExecutionId).toEqual(expect.any(String));

    const successor = await store.getExecution(
      prior?.continuedAsExecutionId ?? "",
    );
    expect(successor).toEqual(
      expect.objectContaining({
        workflowKey: "continue-task",
        parentExecutionId: "parent",
        input: { orderId: "o2" },
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 3,
        timeout: 5000,
        continuedFromExecutionId: "root",
      }),
    );

    expect(kickoffExecution).toHaveBeenCalledWith(successor?.id);
    expect(notifyFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "root",
        status: ExecutionStatus.ContinuedAsNew,
      }),
    );
    expect(callbacks.logStatusChange).toHaveBeenCalledWith({
      execution: expect.objectContaining({ id: "root" }),
      from: ExecutionStatus.Running,
      to: ExecutionStatus.ContinuedAsNew,
      reason: "continued_as_new",
    });
    expect(callbacks.finalizeCancellation).not.toHaveBeenCalled();
  });

  it("drops the continuation when the outcome can no longer persist", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    const { deps, kickoffExecution, notifyFinished } = createDeps(store);
    const callbacks = createCallbacks();

    await continueExecutionAsNew({
      deps,
      runningExecution: runningExecution(),
      nextInput: {},
      canPersistOutcome: async () => false,
      ...callbacks,
    });

    expect(await store.getExecution("root")).toMatchObject({
      status: ExecutionStatus.Running,
    });
    expect(kickoffExecution).not.toHaveBeenCalled();
    expect(notifyFinished).not.toHaveBeenCalled();
    expect(callbacks.finalizeCancellation).not.toHaveBeenCalled();
  });

  it("fails fast when the store cannot commit continuations", async () => {
    const base = new MemoryStore();
    await base.saveExecution(runningExecution());
    const store = createBareStore(base);
    const { deps } = createDeps(store);
    const callbacks = createCallbacks();

    await expect(
      continueExecutionAsNew({
        deps,
        runningExecution: runningExecution(),
        nextInput: {},
        ...callbacks,
      }),
    ).rejects.toThrow("Store does not support continue-as-new");
  });

  it("finalizes cancellation when the prior run already moved on", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...runningExecution(),
      status: ExecutionStatus.Paused,
    });
    const { deps, notifyFinished } = createDeps(store);
    const callbacks = createCallbacks();
    const canPersistOutcome = async () => true;
    const running = runningExecution();

    await continueExecutionAsNew({
      deps,
      runningExecution: running,
      nextInput: {},
      canPersistOutcome,
      ...callbacks,
    });

    expect(callbacks.finalizeCancellation).toHaveBeenCalledWith(
      running,
      canPersistOutcome,
    );
    expect(notifyFinished).not.toHaveBeenCalled();
  });

  it("finalizes cancellation when the atomic commit loses its race", async () => {
    class RacingStore extends MemoryStore {
      override async createContinuedExecution(params: {
        priorExecution: Execution;
        successorExecution: Execution;
      }): Promise<boolean> {
        await this.updateExecution(params.priorExecution.id, {
          status: ExecutionStatus.Cancelling,
        });
        return await super.createContinuedExecution(params);
      }
    }

    const store = new RacingStore();
    await store.saveExecution(runningExecution());
    const { deps, kickoffExecution, notifyFinished } = createDeps(store);
    const callbacks = createCallbacks();
    const running = runningExecution();

    await continueExecutionAsNew({
      deps,
      runningExecution: running,
      nextInput: {},
      ...callbacks,
    });

    expect(callbacks.finalizeCancellation).toHaveBeenCalledWith(
      running,
      undefined,
    );
    expect(kickoffExecution).not.toHaveBeenCalled();
    expect(notifyFinished).not.toHaveBeenCalled();
  });

  it("carries the prior workflow state to the successor", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    await store.saveWorkflowState({
      executionId: "root",
      state: { page: 1 },
      updatedAt: new Date(),
    });
    const { deps } = createDeps(store);
    const callbacks = createCallbacks();

    await continueExecutionAsNew({
      deps,
      runningExecution: runningExecution(),
      nextInput: {},
      ...callbacks,
    });

    const prior = await store.getExecution("root");
    await expect(
      store.getWorkflowState(prior?.continuedAsExecutionId ?? ""),
    ).resolves.toMatchObject({ state: { page: 1 } });
  });

  it("prefers an explicit state override over the carried state", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    await store.saveWorkflowState({
      executionId: "root",
      state: { page: 1 },
      updatedAt: new Date(),
    });
    const { deps } = createDeps(store);
    const callbacks = createCallbacks();

    await continueExecutionAsNew({
      deps,
      runningExecution: runningExecution(),
      nextInput: {},
      options: { state: { page: 9 } },
      ...callbacks,
    });

    const prior = await store.getExecution("root");
    await expect(
      store.getWorkflowState(prior?.continuedAsExecutionId ?? ""),
    ).resolves.toMatchObject({ state: { page: 9 } });
  });

  it("proceeds without carry when the store has no workflow state", async () => {
    const base = new MemoryStore();
    await base.saveExecution(runningExecution());
    const store = createBareStore(base, {
      createContinuedExecution: base.createContinuedExecution.bind(base),
    });
    const { deps, kickoffExecution } = createDeps(store);
    const callbacks = createCallbacks();

    await continueExecutionAsNew({
      deps,
      runningExecution: runningExecution(),
      nextInput: {},
      ...callbacks,
    });

    const prior = await base.getExecution("root");
    expect(prior?.status).toBe(ExecutionStatus.ContinuedAsNew);
    expect(kickoffExecution).toHaveBeenCalledWith(
      prior?.continuedAsExecutionId,
    );
  });

  it("fails fast when carried state cannot be saved", async () => {
    const base = new MemoryStore();
    await base.saveExecution(runningExecution());
    const store = createBareStore(base, {
      createContinuedExecution: base.createContinuedExecution.bind(base),
    });
    const { deps } = createDeps(store);
    const callbacks = createCallbacks();

    await expect(
      continueExecutionAsNew({
        deps,
        runningExecution: runningExecution(),
        nextInput: {},
        options: { state: { page: 9 } },
        ...callbacks,
      }),
    ).rejects.toThrow("Store does not support save-workflow-state");
  });
});
