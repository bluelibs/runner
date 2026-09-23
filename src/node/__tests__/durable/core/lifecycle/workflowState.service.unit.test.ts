import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../../../durable/core/types";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

async function storeWithExecution(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.saveExecution({
    id: "e1",
    workflowKey: "state-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return store;
}

describe("durable: DurableService.getState", () => {
  it("reads the workflow-owned state for one execution", async () => {
    const store = await storeWithExecution();
    const service = new DurableService({ store, tasks: [] });
    await store.saveWorkflowState({
      executionId: "e1",
      state: { page: 3 },
      updatedAt: new Date(),
    });

    await expect(service.getState("e1")).resolves.toEqual({ page: 3 });
  });

  it("resolves undefined until the workflow first sets state", async () => {
    const service = new DurableService({
      store: await storeWithExecution(),
      tasks: [],
    });

    await expect(service.getState("e1")).resolves.toBeUndefined();
  });

  it("fails fast for an unknown execution", async () => {
    const service = new DurableService({ store: new MemoryStore(), tasks: [] });

    await expect(service.getState("missing")).rejects.toThrow(
      "Execution missing not found",
    );
  });

  it("fails fast when the store cannot read state", async () => {
    const service = new DurableService({
      store: createBareStore(await storeWithExecution()),
      tasks: [],
    });

    await expect(service.getState("e1")).rejects.toThrow(
      "Store does not support get-workflow-state",
    );
  });
});
