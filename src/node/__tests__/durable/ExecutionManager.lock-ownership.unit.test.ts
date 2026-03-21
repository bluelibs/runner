import { DurableService } from "../../durable/core/DurableService";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

describe("durable: ExecutionManager lock ownership", () => {
  it("returns early when no persisted lock metadata exists", async () => {
    const service = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    const manager = (service as any)._executionManager;
    const lockState = (manager as any).createExecutionLockState();

    await expect(
      (manager as any).assertStoreLockOwnership(lockState),
    ).resolves.toBeUndefined();
  });

  it("throws the stored loss error when the lock is already marked as lost", async () => {
    const service = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    const manager = (service as any)._executionManager;
    const lockState = (manager as any).createExecutionLockState();
    const lossError = new Error("lock-lost");
    lockState.lost = true;
    lockState.lossError = lossError;

    await expect(
      (manager as any).assertStoreLockOwnership(lockState),
    ).rejects.toThrow("lock-lost");
  });

  it("does not persist completion or suspension after a pre-save ownership recheck fails", async () => {
    const store = new MemoryStore();
    jest.spyOn(store, "renewLock").mockResolvedValue(false);
    const completeTask = okTask("t-lock-complete");
    const suspendTask = okTask("t-lock-suspend");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [completeTask.id]: async () => "ok",
        [suspendTask.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
      tasks: [completeTask, suspendTask],
    });

    await store.saveExecution(
      pendingExecution({ id: "e-lock-complete", taskId: completeTask.id }),
    );
    await store.saveExecution(
      pendingExecution({ id: "e-lock-suspend", taskId: suspendTask.id }),
    );

    await service.processExecution("e-lock-complete");
    await service.processExecution("e-lock-suspend");

    expect((await store.getExecution("e-lock-complete"))?.status).toBe(
      "running",
    );
    expect((await store.getExecution("e-lock-suspend"))?.status).toBe(
      "running",
    );
  });

  it("does not persist failure or retries after a pre-save ownership recheck fails", async () => {
    const store = new MemoryStore();
    jest.spyOn(store, "renewLock").mockResolvedValue(false);
    const failTask = okTask("t-lock-fail");
    const retryTask = okTask("t-lock-retry");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [failTask.id]: async () => {
          throw new Error("fail");
        },
        [retryTask.id]: async () => {
          throw new Error("retry");
        },
      }),
      tasks: [failTask, retryTask],
      execution: { maxAttempts: 2 },
    });

    await store.saveExecution(
      pendingExecution({
        id: "e-lock-fail",
        taskId: failTask.id,
        maxAttempts: 1,
      }),
    );
    await store.saveExecution(
      pendingExecution({
        id: "e-lock-retry",
        taskId: retryTask.id,
        maxAttempts: 2,
      }),
    );

    await service.processExecution("e-lock-fail");
    await service.processExecution("e-lock-retry");

    expect((await store.getExecution("e-lock-fail"))?.status).toBe("running");
    expect((await store.getExecution("e-lock-retry"))?.status).toBe("running");
    expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual(
      [],
    );
  });
});
