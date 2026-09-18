import { DurableContext } from "../../../../durable/core/DurableContext";
import { ContinuationSignal } from "../../../../durable/core/interfaces/context";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";

function runningExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "workflow-1",
    workflowKey: "continue-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function createContext(
  execution?: Execution,
): Promise<{ ctx: DurableContext; store: MemoryStore }> {
  const store = new MemoryStore();
  if (execution) {
    await store.saveExecution(execution);
  }
  const ctx = new DurableContext(
    store,
    new MemoryEventBus(),
    execution?.id ?? "missing",
    1,
  );
  return { ctx, store };
}

describe("durable: DurableContext.continueAsNew", () => {
  it("throws a ContinuationSignal carrying the next input and options", async () => {
    const { ctx } = await createContext(runningExecution());
    const options = { state: { page: 2 } };

    const failure = await ctx.continueAsNew({ orderId: "o1" }, options).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ContinuationSignal);
    expect((failure as ContinuationSignal).nextInput).toEqual({
      orderId: "o1",
    });
    expect((failure as ContinuationSignal).options).toBe(options);
  });

  it("rejects continuing a missing execution", async () => {
    const { ctx } = await createContext();

    await expect(ctx.continueAsNew({})).rejects.toThrow(
      'Cannot continue execution "missing" as new: execution does not exist.',
    );
  });

  it("rejects continuing a paused execution", async () => {
    const { ctx } = await createContext(
      runningExecution({ status: ExecutionStatus.Paused }),
    );

    await expect(ctx.continueAsNew({})).rejects.toThrow(
      'Cannot continue execution "workflow-1" as new: execution is paused.',
    );
  });

  it("rejects continuing a terminal execution", async () => {
    const { ctx } = await createContext(
      runningExecution({ status: ExecutionStatus.Completed }),
    );

    await expect(ctx.continueAsNew({})).rejects.toThrow(
      'Cannot continue execution "workflow-1" as new: execution is completed.',
    );
  });

  it("reports cancellation for a cancelling execution", async () => {
    const { ctx } = await createContext(
      runningExecution({
        status: ExecutionStatus.Cancelling,
        cancelRequestedAt: new Date(),
      }),
    );

    await expect(ctx.continueAsNew({})).rejects.toThrow("Execution cancelled");
  });
});
