import { rollbackDurableCompensations } from "../../../../durable/core/durable-context/DurableContext.steps";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-compensation-race",
    workflowKey: "durable-tests-compensation-race",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function rollbackWithFailingAction(store: IDurableStore) {
  return rollbackDurableCompensations({
    store,
    executionId: "e-compensation-race",
    compensations: [
      {
        stepId: "reserve",
        action: async () => {
          throw new Error("down failed");
        },
      },
    ],
    assertUniqueStepId: () => {},
    internalStep: (() => ({
      up: async (fn: () => Promise<unknown>) => fn(),
    })) as any,
  });
}

describe("durable: compensation failure races", () => {
  it("keeps a paused execution parked when its compensation fails", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        status: ExecutionStatus.Paused,
        pausedAt: new Date(),
        pausedFrom: ExecutionStatus.Running,
      }),
    );

    await expect(rollbackWithFailingAction(store)).rejects.toThrow(
      "Compensation failed",
    );
    const execution = await store.getExecution("e-compensation-race");
    expect(execution?.status).toBe(ExecutionStatus.Paused);
    expect(execution?.pausedFrom).toBe(ExecutionStatus.Running);
    expect(execution?.error).toBeUndefined();
  });

  it("keeps a terminal execution untouched when its compensation fails", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      createExecution({
        status: ExecutionStatus.Cancelled,
        error: { message: "cancelled by operator" },
        completedAt: new Date(),
      }),
    );

    await expect(rollbackWithFailingAction(store)).rejects.toThrow(
      "Compensation failed",
    );
    const execution = await store.getExecution("e-compensation-race");
    expect(execution?.status).toBe(ExecutionStatus.Cancelled);
    expect(execution?.error).toEqual({ message: "cancelled by operator" });
  });

  it("still reports compensation failure when the execution is gone", async () => {
    const store = new MemoryStore();

    await expect(rollbackWithFailingAction(store)).rejects.toThrow(
      "Compensation failed",
    );
    expect(await store.getExecution("e-compensation-race")).toBeNull();
  });

  it("lets a concurrent pause win over the failure write", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createExecution());
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        const current = await base.getExecution(execution.id);
        if (current) {
          await base.saveExecution({
            ...current,
            status: ExecutionStatus.Paused,
            pausedAt: new Date(),
            pausedFrom: ExecutionStatus.Running,
          });
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });

    await expect(rollbackWithFailingAction(store)).rejects.toThrow(
      "Compensation failed",
    );
    const execution = await base.getExecution("e-compensation-race");
    expect(execution?.status).toBe(ExecutionStatus.Paused);
    expect(execution?.error).toBeUndefined();
  });
});
