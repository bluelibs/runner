import { DurableService } from "../../../../durable/core/DurableService";
import type {
  IDurableQueue,
  QueueMessage,
} from "../../../../durable/core/interfaces/queue";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";

function exec(id: string, status: ExecutionStatus): Execution {
  return {
    id,
    workflowKey: "t",
    input: undefined,
    status,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: DurableService.recover branch coverage", () => {
  it("recovers pending, running and timerless suspended executions", async () => {
    class InconsistentStore extends MemoryStore {
      override async listIncompleteExecutions(): Promise<Execution[]> {
        return [
          exec("e-pending", ExecutionStatus.Pending),
          exec("e-running", ExecutionStatus.Running),
          exec("e-sleeping", ExecutionStatus.Sleeping),
          exec("e-retrying", ExecutionStatus.Retrying),
          exec("e-done", ExecutionStatus.Completed),
          exec("e-failed", ExecutionStatus.Failed),
        ];
      }
    }

    const store = new InconsistentStore();
    const service = new DurableService({
      store,
      tasks: [],
      queue: {
        enqueue: jest.fn(async () => "m1"),
        consume: jest.fn(async () => {}),
        ack: jest.fn(async () => {}),
        nack: jest.fn(async () => {}),
      },
    });
    const kickoffSpy = jest
      .spyOn(
        (
          service as unknown as {
            executionManager: {
              recoverExecution: (id: string) => Promise<void>;
            };
          }
        ).executionManager,
        "recoverExecution",
      )
      .mockResolvedValue(undefined);

    const report = await service.recover();

    expect(kickoffSpy).toHaveBeenCalledWith("e-pending");
    expect(kickoffSpy).toHaveBeenCalledWith("e-running");
    expect(kickoffSpy).toHaveBeenCalledWith("e-sleeping");
    expect(kickoffSpy).toHaveBeenCalledWith("e-retrying");
    expect(kickoffSpy).toHaveBeenCalledTimes(4);
    expect(kickoffSpy).not.toHaveBeenCalledWith("e-done");
    expect(kickoffSpy).not.toHaveBeenCalledWith("e-failed");
    expect(report).toEqual({
      scannedCount: 6,
      recoveredCount: 4,
      skippedCount: 2,
      failedCount: 0,
      recovered: [
        { executionId: "e-pending", status: ExecutionStatus.Pending },
        { executionId: "e-running", status: ExecutionStatus.Running },
        { executionId: "e-sleeping", status: ExecutionStatus.Sleeping },
        { executionId: "e-retrying", status: ExecutionStatus.Retrying },
      ],
      skipped: [
        {
          executionId: "e-done",
          status: ExecutionStatus.Completed,
          reason: "not_recoverable",
        },
        {
          executionId: "e-failed",
          status: ExecutionStatus.Failed,
          reason: "not_recoverable",
        },
      ],
      failures: [],
    });
  });

  it("skips immediate recovery when retry and sleep timers are still pending", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const recoverSpy = jest
      .spyOn(
        (
          service as unknown as {
            executionManager: {
              recoverExecution: (id: string) => Promise<void>;
            };
          }
        ).executionManager,
        "recoverExecution",
      )
      .mockResolvedValue(undefined);

    await store.saveExecution(exec("e-retrying", ExecutionStatus.Retrying));
    await store.saveExecution(exec("e-sleeping", ExecutionStatus.Sleeping));
    await store.saveExecution(
      exec("e-signal-timeout", ExecutionStatus.Sleeping),
    );
    await store.createTimer({
      id: "retry:e-retrying:0",
      executionId: "e-retrying",
      type: TimerType.Retry,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "sleep:e-sleeping:nap",
      executionId: "e-sleeping",
      type: TimerType.Sleep,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "signal-timeout:e-sleeping:nap",
      executionId: "e-sleeping",
      type: TimerType.SignalTimeout,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "signal-timeout:e-signal-timeout:wait",
      executionId: "e-signal-timeout",
      type: TimerType.SignalTimeout,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.saveExecution(exec("e-pending", ExecutionStatus.Pending));
    await store.saveExecution(exec("e-running", ExecutionStatus.Running));
    await store.createTimer({
      id: "kickoff:e-pending",
      executionId: "e-pending",
      type: TimerType.Retry,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "kickoff:e-running",
      executionId: "e-running",
      type: TimerType.Retry,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "orphan:timer",
      type: TimerType.Retry,
      fireAt: new Date(Date.now() + 1_000),
      status: TimerStatus.Pending,
    });

    const report = await service.recover();

    expect(recoverSpy).not.toHaveBeenCalled();
    expect(report).toEqual({
      scannedCount: 5,
      recoveredCount: 0,
      skippedCount: 5,
      failedCount: 0,
      recovered: [],
      skipped: [
        {
          executionId: "e-retrying",
          status: ExecutionStatus.Retrying,
          reason: "pending_timer",
        },
        {
          executionId: "e-sleeping",
          status: ExecutionStatus.Sleeping,
          reason: "pending_timer",
        },
        {
          executionId: "e-signal-timeout",
          status: ExecutionStatus.Sleeping,
          reason: "pending_timer",
        },
        {
          executionId: "e-pending",
          status: ExecutionStatus.Pending,
          reason: "pending_timer",
        },
        {
          executionId: "e-running",
          status: ExecutionStatus.Running,
          reason: "pending_timer",
        },
      ],
      failures: [],
    });
  });

  it("isolates per-execution recovery failures and leaves a failsafe timer behind", async () => {
    const store = new MemoryStore();
    const queue: IDurableQueue = {
      enqueue: jest.fn(
        async <TPayload>(
          message: Omit<
            QueueMessage<TPayload>,
            "id" | "createdAt" | "attempts"
          >,
        ) => {
          const payload = message.payload as { executionId: string };
          if (payload.executionId === "e-bad") {
            throw genericError.new({ message: "queue-down" });
          }
          if (payload.executionId === "e-string") {
            throw "plain-queue-down";
          }

          return "m1";
        },
      ),
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
    };
    const service = new DurableService({
      store,
      tasks: [],
      queue,
      execution: { kickoffFailsafeDelayMs: 1_000 },
    });

    await store.saveExecution(exec("e-bad", ExecutionStatus.Pending));
    await store.saveExecution(exec("e-string", ExecutionStatus.Pending));
    await store.saveExecution(exec("e-good", ExecutionStatus.Pending));

    const report = await service.recover();

    expect(queue.enqueue).toHaveBeenCalledWith({
      type: "execute",
      payload: { executionId: "e-bad" },
      maxAttempts: 3,
    });
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: "execute",
      payload: { executionId: "e-string" },
      maxAttempts: 3,
    });
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: "execute",
      payload: { executionId: "e-good" },
      maxAttempts: 3,
    });
    expect(
      (await store.getReadyTimers(new Date(Date.now() + 60_000))).some(
        (timer) => timer.id === "kickoff:e-bad",
      ),
    ).toBe(true);
    expect(report).toEqual({
      scannedCount: 3,
      recoveredCount: 1,
      skippedCount: 0,
      failedCount: 2,
      recovered: [{ executionId: "e-good", status: ExecutionStatus.Pending }],
      skipped: [],
      failures: [
        {
          executionId: "e-bad",
          status: ExecutionStatus.Pending,
          errorMessage: "queue-down",
        },
        {
          executionId: "e-string",
          status: ExecutionStatus.Pending,
          errorMessage: "plain-queue-down",
        },
      ],
    });
  });

  it("still recovers pending executions when no queue is configured", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const recoverSpy = jest
      .spyOn(
        (
          service as unknown as {
            executionManager: {
              recoverExecution: (id: string) => Promise<void>;
            };
          }
        ).executionManager,
        "recoverExecution",
      )
      .mockResolvedValue(undefined);

    await store.saveExecution(exec("e-pending", ExecutionStatus.Pending));

    const report = await service.recover();

    expect(recoverSpy).toHaveBeenCalledWith("e-pending");
    expect(report).toEqual({
      scannedCount: 1,
      recoveredCount: 1,
      skippedCount: 0,
      failedCount: 0,
      recovered: [
        { executionId: "e-pending", status: ExecutionStatus.Pending },
      ],
      skipped: [],
      failures: [],
    });
  });
});
