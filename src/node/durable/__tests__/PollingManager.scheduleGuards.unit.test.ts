import { DurableService } from "../core/DurableService";
import type { Schedule, Timer } from "../core/types";
import { MemoryStore } from "../store/MemoryStore";

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

describe("PollingManager schedule timer guards", () => {
  it("skips schedule timers when the schedule is paused", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    const schedule: Schedule = {
      id: "s1",
      taskId: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "paused",
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date(Date.now() + 1000),
    };
    await store.createSchedule(schedule);

    const timer: Timer = {
      id: "sched:s1",
      scheduleId: "s1",
      taskId: "t",
      input: undefined,
      type: "scheduled",
      fireAt: new Date(schedule.nextRun!),
      status: "pending",
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    expect((await store.listIncompleteExecutions()).length).toBe(0);
    expect((await futureTimers(store)).some((t) => t.id === timer.id)).toBe(
      false,
    );
  });

  it("skips stale schedule timers when fireAt does not match schedule.nextRun", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });

    const schedule: Schedule = {
      id: "s1",
      taskId: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date(Date.now() + 1000),
    };
    await store.createSchedule(schedule);

    const timer: Timer = {
      id: "sched:s1:stale",
      scheduleId: "s1",
      taskId: "t",
      input: undefined,
      type: "scheduled",
      fireAt: new Date(Date.now() + 2000),
      status: "pending",
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    expect((await store.listIncompleteExecutions()).length).toBe(0);
    expect((await futureTimers(store)).some((t) => t.id === timer.id)).toBe(
      false,
    );
  });
});

