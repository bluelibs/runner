import { DurableService } from "../../../../durable/core/DurableService";
import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import {
  createTaskExecutor,
  okTask,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("durable: ExecutionManager lock ownership", () => {
  it("releases the execution lease if a custom ownership scope cannot be created", async () => {
    const store = new MemoryStore();
    const task = okTask("scope-failure");
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: task.id }),
    );
    jest.spyOn(store, "withExecutionOwnership").mockImplementation(() => {
      throw new Error("scope failed");
    });
    const service = new DurableService({ store, tasks: [task] });
    await expect(service.processExecution("one")).rejects.toThrow(
      "scope failed",
    );
    expect(await store.hasExecutionLease("one")).toBe(false);
    await service.stop();
  });
  it("parks a lease lost between the ownership check and the initial state commit", async () => {
    const store = new MemoryStore();
    const task = okTask("atomic-gap");
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: task.id }),
    );
    const save = store.saveExecutionIfStatus.bind(store);
    jest
      .spyOn(store, "saveExecutionIfStatus")
      .mockImplementation(async (execution, expected) => {
        // Simulate the lease expiring in the old check-then-write gap.
        const locks = Reflect.get(store, "locks") as Map<
          string,
          { expires: number }
        >;
        locks.get("execution:one")!.expires = 0;
        return save(execution, expected);
      });
    const run = jest.fn(async () => "unused");
    const service = new DurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: run }),
    });
    await expect(service.processExecution("one")).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect((await store.getExecution("one"))?.status).toBe("pending");
    await service.stop();
  });
  it("propagates unexpected store errors before ownership is lost", async () => {
    const store = new MemoryStore();
    const task = okTask("store-failure");
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: task.id }),
    );
    const original = store.getExecution.bind(store);
    jest
      .spyOn(store, "getExecution")
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("read failed"));
    const service = new DurableService({ store, tasks: [task] });
    await expect(service.processExecution("one")).rejects.toThrow(
      "read failed",
    );
    expect(await store.hasExecutionLease("one")).toBe(false);
    await service.stop();
  });
  it("returns early when no persisted lock metadata exists", async () => {
    const service = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    const manager = (service as any)._executionManager;
    const lockState = createExecutionLockState();

    await expect(
      (manager as any).attemptRunner.assertStoreLockOwnership(lockState),
    ).resolves.toBeUndefined();
  });

  it("throws the stored loss error when the lock is already marked as lost", async () => {
    const service = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    const manager = (service as any)._executionManager;
    const lockState = createExecutionLockState();
    const lossError = new Error("lock-lost");
    lockState.lost = true;
    lockState.lossError = lossError;

    await expect(
      (manager as any).attemptRunner.assertStoreLockOwnership(lockState),
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
      pendingExecution({ id: "e-lock-complete", workflowKey: completeTask.id }),
    );
    await store.saveExecution(
      pendingExecution({ id: "e-lock-suspend", workflowKey: suspendTask.id }),
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
        workflowKey: failTask.id,
        maxAttempts: 1,
      }),
    );
    await store.saveExecution(
      pendingExecution({
        id: "e-lock-retry",
        workflowKey: retryTask.id,
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
