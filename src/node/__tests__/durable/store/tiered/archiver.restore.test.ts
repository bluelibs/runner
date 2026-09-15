import { restoreArchivedExecution } from "../../../../durable/store/tiered/archiver";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubExecution,
  createStubStep,
  createStubStore,
} from "./stub.helpers";

describe("durable: restoreArchivedExecution", () => {
  it("moves archived executions back to hot", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution());
    await cold.saveStepResult(createStubStep());

    const restored = await restoreArchivedExecution({
      hot,
      cold,
      executionId: "exec-1",
    });

    expect(restored).toBe(true);
    await expect(hot.getExecution("exec-1")).resolves.toMatchObject({
      id: "exec-1",
    });
    await expect(hot.listStepResults("exec-1")).resolves.toHaveLength(1);
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("clears hot leftovers before restoring", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveStepResult(
      createStubStep({ executionId: "exec-1", stepId: "orphan" }),
    );
    await cold.saveExecution(createStubExecution());
    await cold.saveStepResult(
      createStubStep({ executionId: "exec-1", stepId: "step-1" }),
    );

    const restored = await restoreArchivedExecution({
      hot,
      cold,
      executionId: "exec-1",
    });

    expect(restored).toBe(true);
    const steps = await hot.listStepResults("exec-1");
    expect(steps.map((step) => step.stepId)).toEqual(["step-1"]);
  });

  it("returns false when there is nothing to restore", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));

    await expect(
      restoreArchivedExecution({ hot, cold, executionId: "live" }),
    ).resolves.toBe(false);
    await expect(
      restoreArchivedExecution({ hot, cold, executionId: "ghost" }),
    ).resolves.toBe(false);
  });

  it("refuses to restore onto the same store", async () => {
    const store = new MemoryStore();

    await expect(
      restoreArchivedExecution({ hot: store, cold: store, executionId: "x" }),
    ).rejects.toThrow(
      "Cannot move durable executions between the same store instance",
    );
  });

  it("requires deleteExecutionData on both tiers before copying", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution());

    const bareCold = createStubStore({ without: ["deleteExecutionData"] });
    await bareCold.saveExecution(createStubExecution());
    await expect(
      restoreArchivedExecution({ hot, cold: bareCold, executionId: "exec-1" }),
    ).rejects.toThrow(
      "Store does not support deleteExecutionData (cold store)",
    );

    const bareHot = createStubStore({ without: ["deleteExecutionData"] });
    await expect(
      restoreArchivedExecution({ hot: bareHot, cold, executionId: "exec-1" }),
    ).rejects.toThrow("Store does not support deleteExecutionData (hot store)");
    await expect(cold.getExecution("exec-1")).resolves.not.toBeNull();
  });

  it("fails fast when the hot copy does not verify", async () => {
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution());
    await cold.saveStepResult(createStubStep());
    const lossyHot = createStubStore({
      overrides: { listStepResults: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      restoreArchivedExecution({
        hot: lossyHot,
        cold,
        executionId: "exec-1",
      }),
    ).rejects.toThrow(
      "Cold storage restore verification failed for execution 'exec-1'",
    );
    await expect(cold.getExecution("exec-1")).resolves.not.toBeNull();
  });
});
