import { DurableContext } from "../../../../durable/core/DurableContext";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

type CounterState = { page: number; total: number };

function runningExecution(): Execution {
  return {
    id: "workflow-1",
    workflowKey: "state-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createContext(
  store: IDurableStore,
  executionId = "workflow-1",
): DurableContext {
  return new DurableContext(store, new MemoryEventBus(), executionId, 1);
}

describe("durable: DurableContext workflow state", () => {
  it("resolves getState to undefined until first set", async () => {
    const ctx = createContext(new MemoryStore());

    await expect(ctx.getState<CounterState>()).resolves.toBeUndefined();
  });

  it("merges patches key-wise across writes", async () => {
    const ctx = createContext(new MemoryStore());

    await ctx.replaceState<CounterState>({ page: 0, total: 0 });
    await ctx.setState<CounterState>({ page: 1 });
    await ctx.setState<CounterState>({ total: 10 });

    await expect(ctx.getState<CounterState>()).resolves.toEqual({
      page: 1,
      total: 10,
    });
  });

  it("replaces state wholesale", async () => {
    const ctx = createContext(new MemoryStore());

    await ctx.replaceState<CounterState>({ page: 1, total: 10 });
    await ctx.replaceState<CounterState>({ page: 2, total: 0 });

    await expect(ctx.getState<CounterState>()).resolves.toEqual({
      page: 2,
      total: 0,
    });
  });

  it("fails fast when patching before state is initialized", async () => {
    const store = new MemoryStore();
    const ctx = createContext(store);

    await expect(ctx.setState<CounterState>({ page: 1 })).rejects.toThrow(
      'Invalid workflow state for execution "workflow-1": setState needs existing object state',
    );
    await expect(store.getWorkflowState("workflow-1")).resolves.toBeNull();
  });

  it.each([
    ["primitive", 5],
    ["array", [1, 2]],
  ])("fails fast when patching %s state", async (_label, current) => {
    const store = new MemoryStore();
    const ctx = createContext(store);

    await ctx.replaceState<unknown>(current);
    await expect(ctx.setState<CounterState>({ page: 1 })).rejects.toThrow(
      "setState needs existing object state",
    );
    await expect(ctx.getState()).resolves.toEqual(current);
  });

  it.each([
    ["array", [3]],
    ["null", null],
    ["class instance", new Date(0)],
  ])("fails fast on a %s patch", async (_label, patch) => {
    const ctx = createContext(new MemoryStore());

    await ctx.replaceState<CounterState>({ page: 0, total: 0 });
    await expect(ctx.setState<typeof patch>(patch)).rejects.toThrow(
      "setState patch must be a plain object",
    );
  });

  it("rejects reads and writes once the execution is cancelled", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...runningExecution(),
      status: ExecutionStatus.Cancelled,
      error: { message: "stopped" },
    });
    await store.saveWorkflowState({
      executionId: "workflow-1",
      state: { page: 1 },
      updatedAt: new Date(),
    });
    const ctx = createContext(store);

    await expect(ctx.setState({ page: 2 })).rejects.toThrow("stopped");
    await expect(ctx.replaceState({ page: 2 })).rejects.toThrow("stopped");
    await expect(ctx.getState()).rejects.toThrow("stopped");
  });

  it("fails fast when the store cannot persist state", async () => {
    const ctx = createContext(createBareStore(new MemoryStore()));

    await expect(ctx.setState({ page: 1 })).rejects.toThrow(
      "Store does not support get-workflow-state",
    );
    await expect(ctx.replaceState({ page: 1 })).rejects.toThrow(
      "Store does not support save-workflow-state",
    );
    await expect(ctx.getState()).rejects.toThrow(
      "Store does not support get-workflow-state",
    );
  });

  it("fails fast when the store cannot save merged state", async () => {
    const base = new MemoryStore();
    await base.saveWorkflowState({
      executionId: "workflow-1",
      state: { page: 0 },
      updatedAt: new Date(),
    });
    const ctx = createContext(
      createBareStore(base, {
        getWorkflowState: base.getWorkflowState.bind(base),
      }),
    );

    await expect(ctx.setState({ page: 1 })).rejects.toThrow(
      "Store does not support save-workflow-state",
    );
  });

  it("reports in-memory attempt info with the observed step count", async () => {
    const ctx = createContext(new MemoryStore());

    expect(ctx.info()).toEqual({
      executionId: "workflow-1",
      attempt: 1,
      stepCount: 0,
    });

    ctx.step("first");
    ctx.step("second");

    expect(ctx.info()).toEqual({
      executionId: "workflow-1",
      attempt: 1,
      stepCount: 2,
    });
  });
});
