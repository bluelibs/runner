import { commandFixture } from "./command.helpers";
import {
  createCommandStore,
  commandContext,
} from "../../../../durable/core/managers/commandContext";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { needsClusterRecovery } from "../../../../durable/core/managers/clusterRecoveryEligibility";

describe("command context boundaries", () => {
  it("preserves adapter properties, namespaces effects, and rejects state after a terminal receipt", async () => {
    const f = await commandFixture();
    const request = await f.enqueue();
    const staged = createCommandStore(f.store, request);
    Object.defineProperty(f.store, "adapterName", { value: "custom-adapter" });
    expect(Reflect.get(staged.store, "adapterName")).toBe("custom-adapter");
    expect(await staged.store.getWorkflowState!("run")).toBeNull();
    await staged.store.saveStepResult({
      executionId: "run",
      stepId: "effect",
      result: true,
      completedAt: new Date(),
    });
    expect((await staged.store.getStepResult("run", "effect"))?.result).toBe(
      true,
    );
    expect(await f.store.getStepResult("run", "effect")).toBeNull();
    await staged.store.saveWorkflowState!({
      executionId: "run",
      state: { n: 2 },
      updatedAt: new Date(),
    });
    expect(await staged.store.getWorkflowState!("run")).toMatchObject({
      state: { n: 2 },
    });
    expect(await f.store.getWorkflowState("run")).toBeNull();
    await f.store.completeCommand({ ...request, status: "failed" });
    await expect(
      staged.store.saveWorkflowState!({
        executionId: "run",
        state: 3,
        updatedAt: new Date(),
      }),
    ).rejects.toThrow("no longer accepts");
    const context = commandContext(
      new DurableContext(staged.store, new NoopEventBus(), "run", 1),
    );
    expect(context.executionId).toBe("run");
    staged.close();
    await expect(context.step("late", async () => 1)).rejects.toThrow(
      "no longer active",
    );
  });

  it("recovers pending commands even when the workflow is parked on a healthy wait", async () => {
    const f = await commandFixture();
    await f.enqueue();
    expect(await needsClusterRecovery(f.store, f.execution)).toBe(true);
    jest.spyOn(f.store, "completeCommand").mockResolvedValueOnce(false);
    await f.manager.rejectPending("run", "closed");
    expect(await f.store.getNextCommand("run")).not.toBeNull();
    const custom = Object.create(f.store) as MemoryStore;
    Object.defineProperty(custom, "getNextCommand", { value: undefined });
    await f.manager.drain(f.execution, f.workflow, custom, f.lock);
    f.config.store = custom;
    await f.manager.rejectPending("run", "closed");
    await f.manager.arm("run");
  });

  it("rejects a successful result whose target changes during commit", async () => {
    const f = await commandFixture();
    await f.enqueue();
    jest.spyOn(f.store, "completeCommand").mockResolvedValueOnce(false);
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("request"))?.error?.message).toContain(
      "changed before",
    );
    await f.enqueue("deleted");
    const original = f.store.getExecution.bind(f.store);
    let reads = 0;
    jest
      .spyOn(f.store, "getExecution")
      .mockImplementation((id) =>
        ++reads === 2 ? Promise.resolve(null) : original(id),
      );
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("deleted"))?.status).toBe("failed");
  });
});
