import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createLifecycleManager,
  lifecycleExecution,
} from "../../helpers/lifecycle.test.helpers";

const workflowKey = "durable-tests-restart-continued-chain";

async function seedChain(
  store: MemoryStore,
  tipStatus: ExecutionStatus,
): Promise<void> {
  await store.saveExecution(
    lifecycleExecution({
      id: "root",
      workflowKey,
      input: { page: 1 },
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    }),
  );
  await store.saveExecution(
    lifecycleExecution({
      id: "tip",
      workflowKey,
      input: { page: 2 },
      status: tipStatus,
      continuedFromExecutionId: "root",
      continuationDepth: 1,
    }),
  );
}

describe("durable: restart of a continued chain", () => {
  it.each([
    ExecutionStatus.Pending,
    ExecutionStatus.Running,
    ExecutionStatus.Sleeping,
  ])(
    "rejects while the chain tip is %s so no second live lineage starts",
    async (tipStatus) => {
      const store = new MemoryStore();
      await seedChain(store, tipStatus);
      const manager = createLifecycleManager({ store });

      await expect(manager.restartExecution("root")).rejects.toThrow(
        `Cannot restart execution "root" with status "continued_as_new (chain tip tip is ${tipStatus})"`,
      );
      expect(await store.listExecutions()).toHaveLength(2);
      expect(
        (await store.getExecution("root"))?.restartedAsExecutionId,
      ).toBeUndefined();
    },
  );

  it("restarts the addressed run from its own input once the chain settled", async () => {
    const store = new MemoryStore();
    await seedChain(store, ExecutionStatus.Completed);
    const manager = createLifecycleManager({ store });

    const restartedId = await manager.restartExecution("root");

    expect(await store.getExecution(restartedId)).toMatchObject({
      input: { page: 1 },
      restartedFromExecutionId: "root",
    });
    expect((await store.getExecution(restartedId))?.continuationDepth).toBe(
      undefined,
    );
    expect((await store.getExecution("root"))?.restartedAsExecutionId).toBe(
      restartedId,
    );
  });

  it("rejects a tip that resumes between the eligibility check and the save", async () => {
    const store = new MemoryStore();
    await seedChain(store, ExecutionStatus.Paused);
    const manager = createLifecycleManager({ store });
    const originalSave = store.saveExecution.bind(store);
    let resumed = false;
    jest.spyOn(store, "saveExecution").mockImplementation(async (execution) => {
      if (!resumed && execution.restartedFromExecutionId === "root") {
        resumed = true;
        await store.updateExecution("tip", {
          status: ExecutionStatus.Sleeping,
        });
      }
      return originalSave(execution);
    });

    await expect(manager.restartExecution("root")).rejects.toThrow(
      "chain tip tip is sleeping",
    );
    const orphan = (await store.listExecutions()).find(
      (execution) => execution.restartedFromExecutionId === "root",
    );
    expect(orphan?.status).toBe(ExecutionStatus.Cancelled);
    expect(
      (await store.getExecution("root"))?.restartedAsExecutionId,
    ).toBeUndefined();
  });

  it("fails fast on a broken chain", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "root",
        workflowKey,
        status: ExecutionStatus.ContinuedAsNew,
      }),
    );
    const manager = createLifecycleManager({ store });

    await expect(manager.restartExecution("root")).rejects.toThrow(
      "without a successor link",
    );
  });
});
