import { DurableService } from "../../durable/core/DurableService";
import type { Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function advanceTimers(ms: number): Promise<void> {
  const asyncAdvance = (
    jest as unknown as {
      advanceTimersByTimeAsync?: (msToRun: number) => Promise<void>;
    }
  ).advanceTimersByTimeAsync;

  if (asyncAdvance) {
    await asyncAdvance(ms);
    return;
  }

  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

describe("durable: ExecutionManager lock heartbeat (unit)", () => {
  it("does not renew locks after the heartbeat is stopped before the first tick", async () => {
    jest.useFakeTimers();

    try {
      const store = new MemoryStore();
      const renewLockSpy = jest.spyOn(store, "renewLock");
      const service = new DurableService({ store, tasks: [] });

      const stopHeartbeat = (
        service._executionManager as unknown as {
          startLockHeartbeat: (params: {
            lockResource: string;
            lockId: string | "no-lock";
            lockTtlMs: number;
            lockState: { lost: boolean };
          }) => () => void;
        }
      ).startLockHeartbeat({
        lockResource: "execution:e-stop",
        lockId: "lock-stop",
        lockTtlMs: 3_000,
        lockState: { lost: false },
      });

      stopHeartbeat();
      await advanceTimers(10_000);

      expect(renewLockSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
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

      const stopHeartbeat = (
        service._executionManager as unknown as {
          startLockHeartbeat: (params: {
            lockResource: string;
            lockId: string | "no-lock";
            lockTtlMs: number;
            lockState: { lost: boolean };
          }) => () => void;
        }
      ).startLockHeartbeat({
        lockResource: "execution:e-overlap",
        lockId: "lock-overlap",
        lockTtlMs: 3_000,
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
      jest.spyOn(store, "renewLock").mockResolvedValueOnce(false);
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
        pendingExecution({ id: "e-lock-lost", taskId: task.id }),
      );

      const processing = service.processExecution("e-lock-lost");
      await flushMicrotasks();
      await advanceTimers(10_000);
      await processing;

      expect((await store.getExecution("e-lock-lost"))?.status).toBe("running");
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores duplicate lock-loss notifications", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    const lockState = (
      service._executionManager as unknown as {
        createExecutionLockState: () => {
          lost: boolean;
          lossError: Error | null;
          triggerLoss: (error: Error) => void;
          waitForLoss: Promise<never>;
        };
      }
    ).createExecutionLockState();

    const firstError = new Error("first");
    lockState.triggerLoss(firstError);
    lockState.triggerLoss(new Error("second"));

    await expect(lockState.waitForLoss).rejects.toBe(firstError);
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
      (
        service._executionManager as unknown as {
          runExecutionAttempt: (
            execution: ReturnType<typeof pendingExecution>,
            taskDef: typeof task,
            lockState: {
              lost: boolean;
              lossError: Error | null;
              triggerLoss: (error: Error) => void;
              waitForLoss: Promise<never>;
            },
          ) => Promise<void>;
        }
      ).runExecutionAttempt(
        pendingExecution({ id: "e-already-lost", taskId: task.id }),
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
        taskId: task.id,
      });
      await store.saveExecution(execution);

      const lockState = {
        lost: false,
        lossError: null,
        triggerLoss: () => {},
        waitForLoss: new Promise<never>(() => {}),
      };

      type TestLockState = typeof lockState;
      const processing = (
        service._executionManager as unknown as {
          runExecutionAttempt: (
            execution: Execution,
            taskDef: typeof task,
            lockState: TestLockState,
          ) => Promise<void>;
        }
      ).runExecutionAttempt(execution, task, lockState);

      lockState.lost = true;
      await advanceTimers(0);

      await expect(processing).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
