import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createLifecycleManager,
  lifecycleExecution,
} from "../../helpers/lifecycle.test.helpers";

async function seedPausedChain(store: MemoryStore): Promise<void> {
  await store.saveExecution(
    lifecycleExecution({
      id: "root",
      workflowKey: "durable-tests-restart-locking",
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    }),
  );
  await store.saveExecution(
    lifecycleExecution({
      id: "tip",
      workflowKey: "durable-tests-restart-locking",
      status: ExecutionStatus.Paused,
      continuedFromExecutionId: "root",
    }),
  );
}

describe("durable: restart lifecycle lock", () => {
  it("fails fast for a continued source when the store has no locks", async () => {
    const store = new MemoryStore();
    await seedPausedChain(store);
    Object.defineProperty(store, "acquireLock", { value: undefined });
    const manager = createLifecycleManager({ store });

    await expect(manager.restartExecution("root")).rejects.toThrow(
      /restart-continued-execution-lock/,
    );
    expect(
      (await store.getExecution("root"))?.restartedAsExecutionId,
    ).toBeUndefined();
  });

  it("rechecks the tip after acquiring its lock if the chain advanced", async () => {
    const store = new MemoryStore();
    await seedPausedChain(store);
    const acquire = store.acquireLock.bind(store);
    let advanced = false;
    jest
      .spyOn(store, "acquireLock")
      .mockImplementation(async (resource, ttl) => {
        if (!advanced && resource === "execution_lifecycle:tip") {
          advanced = true;
          await store.saveExecution(
            lifecycleExecution({
              id: "new-tip",
              workflowKey: "durable-tests-restart-locking",
              status: ExecutionStatus.Paused,
              continuedFromExecutionId: "tip",
            }),
          );
          await store.updateExecution("tip", {
            status: ExecutionStatus.ContinuedAsNew,
            continuedAsExecutionId: "new-tip",
          });
        }
        return acquire(resource, ttl);
      });

    const restartedId = await createLifecycleManager({
      store,
    }).restartExecution("root");
    expect(advanced).toBe(true);
    expect((await store.getExecution("root"))?.restartedAsExecutionId).toBe(
      restartedId,
    );
  });

  it("rejects when the lifecycle lock stays owned by another caller", async () => {
    const store = new MemoryStore();
    await seedPausedChain(store);
    const owner = await store.acquireLock("execution_lifecycle:tip", 10_000);
    expect(owner).not.toBeNull();
    try {
      await expect(
        createLifecycleManager({ store }).restartExecution("root"),
      ).rejects.toThrow("Failed to acquire execution lifecycle lock");
      expect(
        (await store.getExecution("root"))?.restartedAsExecutionId,
      ).toBeUndefined();
    } finally {
      await store.releaseLock("execution_lifecycle:tip", owner!);
    }
  });
});
