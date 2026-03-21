import type {
  IDurableQueue,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { MessageHandler } from "../../durable/core/interfaces/queue";
import { DurableService } from "../../durable/core/DurableService";
import {
  ScheduleStatus,
  TimerStatus,
  TimerType,
  type Timer,
} from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  advanceTimers,
  createTaskExecutor,
  okTask,
} from "./DurableService.unit.helpers";

class RecordingDelayedQueue implements IDurableQueue {
  public enqueued: Array<Pick<QueueMessage, "type" | "payload">> = [];

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    this.enqueued.push({ type: message.type, payload: message.payload });

    return await new Promise<string>((resolve) => {
      setTimeout(() => resolve("queued"), 1_200);
    });
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

describe("durable: PollingManager scheduled timer idempotency", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reuses the same execution when a claimed scheduled timer is retried", async () => {
    const store = new MemoryStore();
    const queue = new RecordingDelayedQueue();
    const task = okTask("t-scheduled-claim-loss");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      taskExecutor: createTaskExecutor({}),
      polling: { claimTtlMs: 3_000 },
    });

    jest.spyOn(store, "renewTimerClaim").mockImplementation(async () => false);

    const timer: Timer = {
      id: "sched:claim-loss",
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const firstAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await firstAttempt;

    await advanceTimers(2_000);

    const secondAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await secondAttempt;

    const executions = await store.listIncompleteExecutions();
    const executionIds = queue.enqueued
      .filter((message) => message.type === "execute")
      .map(
        (message) =>
          (message.payload as { executionId: string | undefined }).executionId,
      );

    expect(executions).toHaveLength(1);
    expect(new Set(executionIds)).toEqual(new Set([executions[0]!.id]));
  });

  it("keeps recurring timers pending until reschedule commits after claim loss", async () => {
    const store = new MemoryStore();
    const queue = new RecordingDelayedQueue();
    const task = okTask("t-recurring-claim-loss");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      taskExecutor: createTaskExecutor({}),
      polling: { claimTtlMs: 3_000 },
    });

    const renewTimerClaimSpy = jest
      .spyOn(store, "renewTimerClaim")
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const schedule = {
      id: "s-recurring-claim-loss",
      taskId: task.id,
      type: "interval" as const,
      pattern: "1000",
      input: undefined,
      status: ScheduleStatus.Active,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      nextRun: new Date(0),
    };
    await store.createSchedule(schedule);

    const timer: Timer = {
      id: "sched:s-recurring-claim-loss",
      scheduleId: schedule.id,
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const firstAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await firstAttempt;

    expect(renewTimerClaimSpy).toHaveBeenCalled();
    expect((await store.getSchedule(schedule.id))?.nextRun).toEqual(
      new Date(0),
    );
    expect(
      (await store.getReadyTimers(new Date(Date.now() + 60_000))).map(
        (ready) => ready.id,
      ),
    ).toContain(timer.id);

    await advanceTimers(2_000);

    const secondAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await secondAttempt;

    const executions = await store.listIncompleteExecutions();
    const executionIds = queue.enqueued
      .filter((message) => message.type === "execute")
      .map(
        (message) =>
          (message.payload as { executionId: string | undefined }).executionId,
      );
    const updatedSchedule = await store.getSchedule(schedule.id);
    const readyTimerIds = (
      await store.getReadyTimers(new Date(Date.now() + 60_000))
    ).map((ready) => ready.id);

    expect(executions).toHaveLength(1);
    expect(new Set(executionIds)).toEqual(new Set([executions[0]!.id]));
    expect(updatedSchedule?.nextRun?.getTime()).toBeGreaterThan(0);
    expect(readyTimerIds.filter((id) => id === timer.id)).toEqual([timer.id]);
  });

  it("finalizes claimed scheduled timers after durable side effects even without store idempotency helpers", async () => {
    const store = new MemoryStore();
    Object.defineProperty(store, "createExecutionWithIdempotencyKey", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const queue = new RecordingDelayedQueue();
    const task = okTask("t-scheduled-no-store-idempotency");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      taskExecutor: createTaskExecutor({}),
      polling: { claimTtlMs: 3_000 },
    });

    const renewTimerClaimSpy = jest
      .spyOn(store, "renewTimerClaim")
      .mockResolvedValue(false as boolean);

    const timer: Timer = {
      id: "sched:no-store-idempotency",
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const firstAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await firstAttempt;

    expect(renewTimerClaimSpy).toHaveBeenCalled();
    expect(await store.getReadyTimers(new Date(0))).toEqual([]);
    expect(await store.getExecution(`timer:${timer.id}`)).toEqual(
      expect.objectContaining({
        id: `timer:${timer.id}`,
        taskId: task.id,
        status: "pending",
      }),
    );
  });

  it("uses atomic claimed-timer finalization when the store supports it", async () => {
    const store = new MemoryStore();
    const finalizeClaimedTimerSpy = jest.spyOn(store, "finalizeClaimedTimer");
    const queue = new RecordingDelayedQueue();
    const task = okTask("t-scheduled-atomic-finalize");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      taskExecutor: createTaskExecutor({}),
      polling: { claimTtlMs: 3_000 },
    });

    const timer: Timer = {
      id: "sched:atomic-finalize",
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const attempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await attempt;

    expect(finalizeClaimedTimerSpy).toHaveBeenCalledWith(
      timer.id,
      expect.any(String),
    );
    expect(await store.getReadyTimers(new Date(0))).toEqual([]);
  });
});
