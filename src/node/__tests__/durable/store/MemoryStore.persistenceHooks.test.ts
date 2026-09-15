import { MemoryStore } from "../../../durable/store/MemoryStore";
import { MemoryStoreRuntime } from "../../../durable/store/memory-store/runtime";
import { toDurableExecutionState } from "../../../durable/core/DurableOperator";

it("preserves persistence hooks for signal and execution-waiter mutations", async () => {
  const store = new MemoryStore();
  const snapshot = store.exportSnapshot();
  const persist = jest.fn().mockResolvedValue(undefined);
  const runtime = new MemoryStoreRuntime({
    captureSnapshot: () => snapshot,
    afterDurableMutation: persist,
  });
  await runtime.withSignalStateMutation(() => ({
    result: true,
    changed: true,
  }));
  await runtime.withExecutionWaiterMutation(() => ({
    result: true,
    changed: true,
  }));
  expect(persist).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenCalledWith(snapshot);
  class Extension extends MemoryStore {
    async flushBaseHook() {
      await super.afterDurableMutation(this.captureDurableMutationSnapshot());
    }
  }
  await new Extension().flushBaseHook();
  expect(
    toDurableExecutionState({
      id: "id",
      workflowKey: "wf",
      status: "completed",
      input: "secret",
      createdAt: new Date(),
      updatedAt: new Date(),
      attempt: 1,
      maxAttempts: 1,
    }),
  ).not.toHaveProperty("input");
});
