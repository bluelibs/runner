import { DurableContext } from "../../../../durable/core/DurableContext";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";

type CounterState = { page: number; total: number };

const executionId = "workflow-replay";

function runningExecution(
  overrides: Partial<Execution> = {},
): Execution<unknown, unknown> {
  return {
    id: executionId,
    workflowKey: "state-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createAttempt(store: MemoryStore, attempt = 1): DurableContext {
  return new DurableContext(store, new MemoryEventBus(), executionId, attempt);
}

// Mirrors the documented read-modify-write: each attempt replays the prefix.
async function incrementPage(ctx: DurableContext): Promise<CounterState> {
  const current = (await ctx.getState<CounterState>()) ?? {
    page: 0,
    total: 0,
  };
  await ctx.replaceState<CounterState>({ ...current, page: current.page + 1 });
  return current;
}

describe("durable: DurableContext workflow state replay", () => {
  it("returns the historical read and skips applied writes on replay", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());

    await expect(incrementPage(createAttempt(store, 1))).resolves.toEqual({
      page: 0,
      total: 0,
    });
    await expect(incrementPage(createAttempt(store, 2))).resolves.toEqual({
      page: 0,
      total: 0,
    });

    await expect(store.getWorkflowState(executionId)).resolves.toEqual(
      expect.objectContaining({ state: { page: 1, total: 0 } }),
    );
  });

  it("never regresses the live record while replaying earlier writes", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    const first = createAttempt(store, 1);
    await first.replaceState<CounterState>({ page: 1, total: 0 });
    await first.setState<CounterState>({ page: 2 });

    const replay = createAttempt(store, 2);
    await replay.replaceState<CounterState>({ page: 1, total: 0 });

    await expect(store.getWorkflowState(executionId)).resolves.toEqual(
      expect.objectContaining({ state: { page: 2, total: 0 } }),
    );
    await replay.setState<CounterState>({ page: 2 });
    await expect(replay.getState<CounterState>()).resolves.toEqual({
      page: 2,
      total: 0,
    });
  });

  it("keeps reads and writes in separate deterministic step namespaces", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution());
    const ctx = createAttempt(store);

    await ctx.getState();
    await ctx.replaceState({ page: 1 });
    await ctx.setState({ total: 2 });
    await ctx.getState();

    const stepIds = (await store.listStepResults(executionId)).map(
      (step) => step.stepId,
    );
    expect(stepIds.sort()).toEqual([
      "__state:read:0",
      "__state:read:1",
      "__state:write:0",
      "__state:write:1",
    ]);
    expect(ctx.info().stepCount).toBe(4);
  });

  it("serves reads during cancellation teardown but rejects writes", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      runningExecution({
        status: ExecutionStatus.Cancelling,
        cancelRequestedAt: new Date(),
        error: { message: "stopping" },
      }),
    );
    await store.saveWorkflowState({
      executionId,
      state: { page: 1 },
      updatedAt: new Date(),
    });
    const ctx = createAttempt(store);

    await expect(ctx.getState()).resolves.toEqual({ page: 1 });
    await expect(ctx.setState({ page: 2 })).rejects.toThrow("stopping");
    await expect(ctx.replaceState({ page: 2 })).rejects.toThrow("stopping");
  });
});
