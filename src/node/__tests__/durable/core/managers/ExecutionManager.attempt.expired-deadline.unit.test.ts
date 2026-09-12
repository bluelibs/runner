import { r } from "../../../../..";
import { genericError } from "../../../../../errors";
import type { ITask } from "../../../../../types/task";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { runTaskAttempt } from "../../../../durable/core/managers/ExecutionManager.attempt";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";

type AttemptTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

function attemptTask(id: string): AttemptTask {
  return r
    .task(id)
    .run(async (_input: unknown) => "ok")
    .build();
}

function createContext(executionId: string): DurableContext {
  return new DurableContext(
    new MemoryStore(),
    {
      publish: async () => undefined,
      subscribe: async () => undefined,
      unsubscribe: async () => undefined,
    },
    executionId,
    1,
  );
}

function expiredExecution(taskId: string, executionId: string): Execution {
  return {
    ...pendingExecution({
      id: executionId,
      workflowKey: taskId,
    }),
    status: ExecutionStatus.Running,
    timeout: 1,
    createdAt: new Date(Date.now() - 1_000),
  };
}

async function collectUnhandledRejections<T>(
  work: () => Promise<T>,
): Promise<{ result: T; unhandled: unknown[] }> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const result = await work();
    await Promise.resolve();
    await Promise.resolve();
    return { result, unhandled };
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

describe("durable: runTaskAttempt expired deadline", () => {
  it("does not launch the task when the deadline has already elapsed", async () => {
    const task = attemptTask("t-expired-deadline");
    const run = jest.fn(async () => {
      throw genericError.new({ message: "cooperative reject" });
    });
    const transitionToFailed = jest.fn(async () => undefined);
    const abortAttempt = jest.fn();

    const { result, unhandled } = await collectUnhandledRejections(() =>
      runTaskAttempt({
        task,
        input: undefined,
        context: createContext("e-expired"),
        execution: expiredExecution(task.id, "e-expired"),
        taskExecutor: { run },
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: async () => true,
        abortAttempt,
        transitionToFailed,
      }),
    );

    expect(result).toEqual({ kind: "already-finalized" });
    expect(run).not.toHaveBeenCalled();
    expect(abortAttempt).toHaveBeenCalledTimes(1);
    expect(transitionToFailed).toHaveBeenCalledWith({
      execution: expect.objectContaining({ id: "e-expired" }),
      from: ExecutionStatus.Running,
      reason: "timed_out",
      error: { message: "Execution e-expired timed out" },
    });
    expect(unhandled).toEqual([]);
  });

  it("skips timeout persistence when the outcome can no longer be written", async () => {
    const task = attemptTask("t-expired-deadline-recheck");
    const run = jest.fn(async () => {
      throw genericError.new({ message: "cooperative reject" });
    });
    const transitionToFailed = jest.fn(async () => undefined);

    const { result, unhandled } = await collectUnhandledRejections(() =>
      runTaskAttempt({
        task,
        input: undefined,
        context: createContext("e-expired-recheck"),
        execution: expiredExecution(task.id, "e-expired-recheck"),
        taskExecutor: { run },
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: async () => false,
        abortAttempt: () => undefined,
        transitionToFailed,
      }),
    );

    expect(result).toEqual({ kind: "already-finalized" });
    expect(run).not.toHaveBeenCalled();
    expect(transitionToFailed).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("aborts and consumes the task promise when the in-flight deadline fires", async () => {
    jest.useFakeTimers();
    const task = attemptTask("t-inflight-timeout");
    let rejectTask!: (error: unknown) => void;
    const run = jest.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectTask = reject;
        }),
    );
    const abortAttempt = jest.fn(() => {
      rejectTask(genericError.new({ message: "cooperative reject" }));
    });
    const transitionToFailed = jest.fn(async () => undefined);

    try {
      const { unhandled } = await collectUnhandledRejections(async () => {
        const attempt = runTaskAttempt({
          task,
          input: undefined,
          context: createContext("e-inflight"),
          execution: {
            ...pendingExecution({
              id: "e-inflight",
              workflowKey: task.id,
            }),
            status: ExecutionStatus.Running,
            timeout: 50,
            createdAt: new Date(),
          },
          taskExecutor: { run },
          raceWithLockLoss: async (promise) => await promise,
          canPersistOutcome: async () => true,
          abortAttempt,
          transitionToFailed,
        });

        await jest.advanceTimersByTimeAsync(50);
        await expect(attempt).rejects.toThrow("Execution e-inflight timed out");
      });

      expect(run).toHaveBeenCalledTimes(1);
      expect(abortAttempt).toHaveBeenCalledTimes(1);
      expect(transitionToFailed).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});
