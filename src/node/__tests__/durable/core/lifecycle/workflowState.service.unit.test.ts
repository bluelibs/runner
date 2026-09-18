import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

describe("durable: DurableService.getState", () => {
  it("reads the workflow-owned state for one execution", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    await store.saveWorkflowState({
      executionId: "e1",
      state: { page: 3 },
      updatedAt: new Date(),
    });

    await expect(service.getState("e1")).resolves.toEqual({ page: 3 });
  });

  it("resolves undefined until the workflow first sets state", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    await expect(service.getState("e1")).resolves.toBeUndefined();
  });

  it("fails fast when the store cannot read state", async () => {
    const service = new DurableService({
      store: createBareStore(new MemoryStore()),
      tasks: [],
    });

    await expect(service.getState("e1")).rejects.toThrow(
      "Store does not support get-workflow-state",
    );
  });
});
