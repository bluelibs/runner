import { DurableService } from "../../durable/core/DurableService";
import {
  ScheduleStatus,
  TimerStatus,
  TimerType,
  type Schedule,
  type Timer,
} from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  SpyQueue,
  createBareStore,
  createTaskExecutor,
  okTask,
  sleepingExecution,
} from "./DurableService.unit.helpers";

describe("durable: DurableService.handleTimer branch edges", () => {
  it("handles one-off scheduled timers without claimTimer support", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base);
    const task = okTask("t.oneoff.no-claim");
    const service = new DurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const timer: Timer = {
      id: "oneoff:no-claim",
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);
    const kickoffSpy = jest.spyOn(
      (
        service as unknown as {
          executionManager: { kickoffExecution: (id: string) => Promise<void> };
        }
      ).executionManager,
      "kickoffExecution",
    );

    await service.handleTimer(timer);

    expect(kickoffSpy).toHaveBeenCalledTimes(1);
    expect(
      (await store.getReadyTimers(new Date(Date.now() + 60_000))).some(
        (t) => t.id === timer.id,
      ),
    ).toBe(false);
  });

  it("skips signal-timeout completion when the signal step is not waiting", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    const timer: Timer = {
      id: "signal-timeout:e1",
      executionId: "e1",
      stepId: "__signal:paid",
      type: TimerType.SignalTimeout,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("does not reschedule when the schedule becomes inactive before post-run refresh", async () => {
    class FlakyScheduleStore extends MemoryStore {
      private scheduleReads = 0;

      override async getSchedule(id: string) {
        const schedule = await super.getSchedule(id);
        if (!schedule || id !== "s1") return schedule;
        this.scheduleReads += 1;
        if (this.scheduleReads === 1) return schedule;
        return { ...schedule, status: ScheduleStatus.Paused };
      }
    }

    const store = new FlakyScheduleStore();
    const task = okTask("t.schedule.recheck");
    const service = new DurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
    });

    const rescheduleSpy = jest
      .spyOn(
        (
          service as unknown as {
            scheduleManager: {
              reschedule: (schedule: Schedule) => Promise<void>;
            };
          }
        ).scheduleManager,
        "reschedule",
      )
      .mockResolvedValue(undefined);

    const schedule: Schedule = {
      id: "s1",
      taskId: task.id,
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: ScheduleStatus.Active,
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date(Date.now() + 1000),
    };
    await store.createSchedule(schedule);

    const timer: Timer = {
      id: "sched:s1",
      scheduleId: "s1",
      taskId: task.id,
      input: undefined,
      type: TimerType.Scheduled,
      fireAt: new Date(schedule.nextRun!),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    expect(rescheduleSpy).not.toHaveBeenCalled();
  });
});
