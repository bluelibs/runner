import { DurableService } from "../../durable/core/DurableService";
import type { Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  advanceTimers,
  captureScheduledTimeout,
  createTaskExecutor,
  flushMicrotasks,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

type TestExecutionManager = {
  startLockHeartbeat: (params: {
    lockResource: string;
    lockId: string | "no-lock";
    lockTtlMs: number;
    lockState: { lost: boolean };
  }) => () => void;
  createExecutionLockState: () => {
    lost: boolean;
    lossError: Error | null;
    triggerLoss: (error: Error) => void;
    waitForLoss: Promise<never>;
  };
  markExecutionLockLost: (
    lockState: {
      lost: boolean;
      lossError: Error | null;
      triggerLoss: (error: Error) => void;
      waitForLoss: Promise<never>;
    },
    lockResource: string,
  ) => Error;
  runExecutionAttempt: (
    execution: Execution,
    taskDef: ReturnType<typeof okTask>,
    lockState: {
      lost: boolean;
      lossError: Error | null;
      triggerLoss: (error: Error) => void;
      waitForLoss: Promise<never>;
    },
  ) => Promise<void>;
};

function getTestExecutionManager(
  service: DurableService,
): TestExecutionManager {
  return service._executionManager as unknown as TestExecutionManager;
}

function startLockHeartbeat(
  service: DurableService,
  params: {
    lockResource: string;
    lockId: string | "no-lock";
    lockTtlMs?: number;
    lockState?: { lost: boolean };
  },
): () => void {
  return getTestExecutionManager(service).startLockHeartbeat({
    lockResource: params.lockResource,
    lockId: params.lockId,
    lockTtlMs: params.lockTtlMs ?? 3_000,
    lockState: params.lockState ?? { lost: false },
  });
}

describe("durable: ExecutionManager lock heartbeat (unit)", () => {
  it("does not renew locks after the heartbeat is stopped before the first tick", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      const renewLockSpy = jest.spyOn(store, "renewLock");
      const service = new DurableService({ store, tasks: [] });
      const stopHeartbeat = startLockHeartbeat(service, {
        lockResource: "execution:e-stop",
        lockId: "lock-stop",
        lockState: { lost: false },
      });

      stopHeartbeat();
      await advanceTimers(10_000);

      expect(renewLockSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores an already-scheduled renewal callback after the heartbeat is stopped", async () => {
    const store = new MemoryStore();
    const renewLockSpy = jest.spyOn(store, "renewLock");
    const service = new DurableService({ store, tasks: [] });
    const scheduledTimeout = captureScheduledTimeout();

    try {
      const stopHeartbeat = startLockHeartbeat(service, {
        lockResource: "execution:e-stopped-callback",
        lockId: "lock-stopped-callback",
        lockState: { lost: false },
      });

      stopHeartbeat();
      const callback = scheduledTimeout.getScheduledCallback(
        "Expected lock-heartbeat callback to be scheduled",
      );
      callback();
      await flushMicrotasks();

      expect(renewLockSpy).not.toHaveBeenCalled();
    } finally {
      scheduledTimeout.restore();
    }
  });

  it("does not require timer handles to expose unref", () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const mockSetTimeout = (() => ({})) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(mockSetTimeout);

    try {
      const stopHeartbeat = startLockHeartbeat(service, {
        lockResource: "execution:e-no-unref",
        lockId: "lock-no-unref",
        lockState: { lost: false },
      });

      expect(stopHeartbeat).toBeInstanceOf(Function);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("stops cleanly after a lock renewal has already started", async () => {
    const store = new MemoryStore();
    let resolveRenewal!: (value: boolean) => void;
    jest.spyOn(store, "renewLock").mockImplementation(
      async () =>
        await new Promise<boolean>((resolve) => {
          resolveRenewal = resolve;
        }),
    );
    const service = new DurableService({ store, tasks: [] });
    const scheduledTimeout = captureScheduledTimeout();

    try {
      const stopHeartbeat = startLockHeartbeat(service, {
        lockResource: "execution:e-in-flight-stop",
        lockId: "lock-in-flight-stop",
        lockState: { lost: false },
      });

      const callback = scheduledTimeout.getScheduledCallback(
        "Expected lock-heartbeat callback to be scheduled",
      );
      callback();
      stopHeartbeat();
      resolveRenewal(true);
      await flushMicrotasks();

      expect(scheduledTimeout.clearTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      scheduledTimeout.restore();
    }
  });

  it("does not overlap renewLock calls while a renewal is still pending", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      let resolveRenewal!: (value: boolean) => void;
      const renewLockSpy = jest.spyOn(store, "renewLock").mockImplementation(
        async () =>
          await new Promise<boolean>((resolve) => {
            resolveRenewal = resolve;
          }),
      );
      const service = new DurableService({ store, tasks: [] });
      const stopHeartbeat = startLockHeartbeat(service, {
        lockResource: "execution:e-overlap",
        lockId: "lock-overlap",
        lockState: { lost: false },
      });

      await advanceTimers(1_000);
      expect(renewLockSpy).toHaveBeenCalledTimes(1);

      await advanceTimers(1_000);
      expect(renewLockSpy).toHaveBeenCalledTimes(1);

      resolveRenewal(true);
      await flushMicrotasks();
      stopHeartbeat();
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns early when renewLock reports ownership loss mid-attempt", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      const renewLockSpy = jest
        .spyOn(store, "renewLock")
        .mockResolvedValueOnce(false);
      const task = okTask("t-lock-lost");
      const service = new DurableService({
        store,
        taskExecutor: createTaskExecutor({
          [task.id]: async () =>
            await new Promise((resolve) => {
              setTimeout(() => resolve("ok"), 12_000);
            }),
        }),
        tasks: [task],
      });

      await store.saveExecution(
        pendingExecution({ id: "e-lock-lost", workflowKey: task.id }),
      );

      const processing = service.processExecution("e-lock-lost");
      await flushMicrotasks();
      await advanceTimers(10_000);
      await processing;

      expect(renewLockSpy).toHaveBeenCalledTimes(1);
      expect((await store.getExecution("e-lock-lost"))?.status).toBe("running");
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the attempt alive when a heartbeat renew fails transiently", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      jest
        .spyOn(store, "renewLock")
        .mockRejectedValueOnce(new Error("transient-renew-failure"))
        .mockResolvedValue(true);
      const task = okTask("t-lock-transient-renew");
      const service = new DurableService({
        store,
        taskExecutor: createTaskExecutor({
          [task.id]: async () =>
            await new Promise((resolve) => {
              setTimeout(() => resolve("ok"), 12_000);
            }),
        }),
        tasks: [task],
      });

      await store.saveExecution(
        pendingExecution({
          id: "e-lock-transient-renew",
          workflowKey: task.id,
        }),
      );

      const processing = service.processExecution("e-lock-transient-renew");
      await flushMicrotasks();
      await advanceTimers(12_500);
      await processing;

      expect((await store.getExecution("e-lock-transient-renew"))?.status).toBe(
        "completed",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not persist completion after a pre-save ownership recheck fails", async () => {
    const store = new MemoryStore();
    const task = okTask("t-lock-recheck-complete");
    jest.spyOn(store, "renewLock").mockResolvedValue(false);
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
    });

    await store.saveExecution(
      pendingExecution({ id: "e-lock-recheck-complete", workflowKey: task.id }),
    );

    await service.processExecution("e-lock-recheck-complete");

    expect((await store.getExecution("e-lock-recheck-complete"))?.status).toBe(
      "running",
    );
  });

  it("does not schedule a retry after a pre-save ownership recheck fails", async () => {
    const store = new MemoryStore();
    const task = okTask("t-lock-recheck-retry");
    jest.spyOn(store, "renewLock").mockResolvedValue(false);
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new Error("boom");
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 2 },
    });

    await store.saveExecution(
      pendingExecution({ id: "e-lock-recheck-retry", workflowKey: task.id }),
    );

    await service.processExecution("e-lock-recheck-retry");

    expect((await store.getExecution("e-lock-recheck-retry"))?.status).toBe(
      "running",
    );
    expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual(
      [],
    );
  });

  it("ignores duplicate lock-loss notifications", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const lockState =
      getTestExecutionManager(service).createExecutionLockState();

    const firstError = new Error("first");
    lockState.triggerLoss(firstError);
    lockState.triggerLoss(new Error("second"));

    await expect(lockState.waitForLoss).rejects.toBe(firstError);
  });

  it("keeps the first lock-loss error stable across duplicate lock-loss markings", () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const manager = getTestExecutionManager(service);
    const lockState = manager.createExecutionLockState();

    const firstError = manager.markExecutionLockLost(
      lockState,
      "execution:e-duplicate-loss",
    );
    const secondError = manager.markExecutionLockLost(
      lockState,
      "execution:e-duplicate-loss",
    );

    expect(secondError).toBe(firstError);
    expect(lockState.lossError).toBe(firstError);
  });

  it("throws immediately when an attempt starts with a lost lock", async () => {
    const store = new MemoryStore();
    const task = okTask("t-lock-already-lost");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task],
    });

    await expect(
      getTestExecutionManager(service).runExecutionAttempt(
        pendingExecution({ id: "e-already-lost", workflowKey: task.id }),
        task,
        {
          lost: true,
          lossError: null,
          triggerLoss: () => {},
          waitForLoss: new Promise<never>(() => {}),
        },
      ),
    ).rejects.toThrow("Execution lock lost");
  });

  it("returns when a task failure arrives after lock ownership was already lost", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      const task = okTask("t-lock-lost-during-error");
      const service = new DurableService({
        store,
        taskExecutor: createTaskExecutor({
          [task.id]: async () =>
            await new Promise((_, reject) => {
              setTimeout(() => reject(new Error("boom")), 0);
            }),
        }),
        tasks: [task],
      });

      const execution = pendingExecution({
        id: "e-lock-lost-during-error",
        workflowKey: task.id,
      });
      await store.saveExecution(execution);

      const lockState = {
        lost: false,
        lossError: null,
        triggerLoss: () => {},
        waitForLoss: new Promise<never>(() => {}),
      };

      type TestLockState = typeof lockState;
      const processing = getTestExecutionManager(service).runExecutionAttempt(
        execution,
        task,
        lockState as TestLockState,
      );

      lockState.lost = true;
      await advanceTimers(0);

      await expect(processing).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
