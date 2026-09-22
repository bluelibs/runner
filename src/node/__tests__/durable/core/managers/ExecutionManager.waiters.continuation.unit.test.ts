import { Logger } from "../../../../../models/Logger";
import { resolveExecutionWaiters } from "../../../../durable/core/managers/ExecutionManager.waiters";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function continuedExecution(): Execution {
  return {
    id: "child",
    workflowKey: "child-task",
    input: undefined,
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: "tip",
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createLogger(): Logger {
  return new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });
}

describe("durable: resolveExecutionWaiters continuation", () => {
  it("completes a followed wait registered on the tip", async () => {
    const store = new MemoryStore();
    const kickoffExecution = jest.fn(async () => undefined);
    const tip: Execution = {
      id: "tip",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      continuedFromExecutionId: "child",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(tip);
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    await resolveExecutionWaiters({
      store,
      execution: tip,
      kickoffExecution,
      logger: createLogger(),
    });

    expect(await store.getStepResult("parent", "__execution:child")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child",
          result: { ok: true },
        }),
      }),
    );
    expect(await store.listExecutionWaiters("tip")).toEqual([]);
    expect(kickoffExecution).toHaveBeenCalledWith("parent");
  });

  it("completes a followed wait whose replayed step still holds a follow marker", async () => {
    const store = new MemoryStore();
    const kickoffExecution = jest.fn(async () => undefined);
    const tip: Execution = {
      id: "tip",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      continuedFromExecutionId: "child",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(tip);
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: {
        state: "continued",
        targetExecutionId: "child",
        continuedAsExecutionId: "tip",
        workflowKey: "child-task",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    await resolveExecutionWaiters({
      store,
      execution: tip,
      kickoffExecution,
      logger: createLogger(),
    });

    expect(await store.getStepResult("parent", "__execution:child")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child",
          result: { ok: true },
        }),
      }),
    );
    expect(await store.listExecutionWaiters("tip")).toEqual([]);
    expect(kickoffExecution).toHaveBeenCalledWith("parent");
  });

  it("resolves waiters with follow markers preserving root and deadline", async () => {
    const store = new MemoryStore();
    const kickoffExecution = jest.fn(async () => undefined);
    await store.saveExecution(continuedExecution());
    await store.saveExecution({
      id: "parent",
      workflowKey: "parent-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: {
        state: "waiting",
        targetExecutionId: "child",
        timeoutMs: 1000,
        timeoutAtMs: 2000,
        timerId: "execution_timeout:parent:__execution:child",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "child",
      stepId: "__execution:child",
      timerId: "execution_timeout:parent:__execution:child",
    });

    await resolveExecutionWaiters({
      store,
      execution: continuedExecution(),
      kickoffExecution,
      logger: createLogger(),
    });

    expect(await store.getStepResult("parent", "__execution:child")).toEqual(
      expect.objectContaining({
        result: {
          state: "continued",
          targetExecutionId: "child",
          continuedAsExecutionId: "tip",
          workflowKey: "child-task",
          timeoutMs: 1000,
          timeoutAtMs: 2000,
          timerId: "execution_timeout:parent:__execution:child",
        },
      }),
    );
    expect(await store.listExecutionWaiters("child")).toEqual([]);
    expect(kickoffExecution).toHaveBeenCalledWith("parent");
  });

  it("degrades the marker when the waiting step is missing", async () => {
    const store = new MemoryStore();
    const kickoffExecution = jest.fn(async () => undefined);
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "child",
      stepId: "__execution:child",
    });

    await resolveExecutionWaiters({
      store,
      execution: continuedExecution(),
      kickoffExecution,
      logger: createLogger(),
    });

    // The marker degrades to the current hop, but the atomic commit refuses
    // to create a completion for a step that was never registered, so the
    // waiter is left for replay validation to report at the reader.
    expect(await store.getStepResult("parent", "__execution:child")).toBeNull();
    expect(await store.listExecutionWaiters("child")).toHaveLength(1);
    expect(kickoffExecution).not.toHaveBeenCalled();
  });

  it("degrades the marker when the waiting step holds a terminal state", async () => {
    const store = new MemoryStore();
    const kickoffExecution = jest.fn(async () => undefined);
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: {
        state: "completed",
        targetExecutionId: "child",
        workflowKey: "child-task",
        result: { stale: true },
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "child",
      stepId: "__execution:child",
    });

    await resolveExecutionWaiters({
      store,
      execution: continuedExecution(),
      kickoffExecution,
      logger: createLogger(),
    });

    // The terminal step is left untouched: the commit refuses to overwrite
    // a completed wait, so the waiter stays queued for replay validation.
    expect(await store.getStepResult("parent", "__execution:child")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ state: "completed" }),
      }),
    );
    expect(await store.listExecutionWaiters("child")).toHaveLength(1);
    expect(kickoffExecution).not.toHaveBeenCalled();
  });
});
