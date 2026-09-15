import { ExecutionStatus } from "../../../../durable/core/types";
import { TieredDurableStore } from "../../../../durable/store/tiered/TieredDurableStore";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createFnStore,
  createStubExecution,
  createStubStep,
} from "./stub.helpers";

async function seedArchived(cold: MemoryStore, id: string): Promise<void> {
  await cold.saveExecution(
    createStubExecution({
      id,
      status: ExecutionStatus.CompensationFailed,
    }),
  );
  await cold.saveStepResult(createStubStep({ executionId: id }));
}

describe("durable: TieredDurableStore operator restore", () => {
  it("restores archived executions before retryRollback", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedArchived(cold, "exec-1");
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.retryRollback!("exec-1");

    await expect(hot.getExecution("exec-1")).resolves.toMatchObject({
      status: "pending",
    });
    await expect(hot.listStepResults("exec-1")).resolves.toHaveLength(1);
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("restores archived executions before skipStep", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedArchived(cold, "exec-1");
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.skipStep!("exec-1", "step-broken");

    await expect(
      hot.getStepResult("exec-1", "step-broken"),
    ).resolves.toMatchObject({ stepId: "step-broken" });
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("restores archived executions before forceFail", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution({ id: "exec-1" }));
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.forceFail!("exec-1", { message: "manual" });

    await expect(hot.getExecution("exec-1")).resolves.toMatchObject({
      status: "failed",
    });
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("restores archived executions before editStepResult", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await cold.saveExecution(createStubExecution({ id: "exec-1" }));
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.editStepResult!("exec-1", "step-1", { patched: true });

    await expect(hot.getStepResult("exec-1", "step-1")).resolves.toMatchObject({
      result: { patched: true },
    });
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("skips restore for live and unknown executions", async () => {
    const hot = new MemoryStore();
    const cold = createFnStore();
    await hot.saveExecution(
      createStubExecution({
        id: "live",
        status: ExecutionStatus.CompensationFailed,
      }),
    );
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.retryRollback!("live");
    await tiered.skipStep!("ghost", "step-1");

    await expect(hot.getExecution("live")).resolves.toMatchObject({
      status: "pending",
    });
    expect(cold.getExecution).toHaveBeenCalledTimes(1);
    expect(cold.getExecution).toHaveBeenCalledWith("ghost");
  });
});
