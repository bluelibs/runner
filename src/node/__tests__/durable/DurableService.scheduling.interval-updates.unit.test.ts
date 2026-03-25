import { DurableService } from "../../durable/core/DurableService";
import {
  TimerStatus,
  TimerType,
  type Schedule,
  type Timer,
} from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createTaskExecutor } from "./DurableService.unit.helpers";

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

async function persistActiveIntervalSchedule(
  store: MemoryStore,
  schedule: Schedule,
): Promise<void> {
  await store.saveScheduleWithTimer(schedule, {
    id: `sched:${schedule.id}`,
    scheduleId: schedule.id,
    workflowKey: schedule.workflowKey,
    input: schedule.input,
    type: TimerType.Scheduled,
    fireAt: schedule.nextRun!,
    status: TimerStatus.Pending,
  });
}

describe("durable: DurableService — schedule interval updates (unit)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("re-anchors active interval cadence changes from the last completed run", async () => {
    const nowMs = Date.parse("2026-02-10T12:00:00.000Z");
    jest.useFakeTimers().setSystemTime(nowMs);

    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await persistActiveIntervalSchedule(store, {
      id: "s1",
      workflowKey: "task-a",
      type: "interval",
      pattern: "20000",
      input: { version: 1 },
      status: "active",
      createdAt: new Date(nowMs - 40_000),
      updatedAt: new Date(nowMs - 40_000),
      lastRun: new Date(nowMs - 10_000),
      nextRun: new Date(nowMs + 10_000),
    });

    await service.updateSchedule("s1", { interval: 5_000 });

    const updated = await store.getSchedule("s1");
    const timer = (await futureTimers(store)).find(
      (entry) => entry.id === "sched:s1",
    );

    expect(updated?.pattern).toBe("5000");
    expect(updated?.nextRun?.toISOString()).toBe("2026-02-10T12:00:05.000Z");
    expect(timer?.fireAt.toISOString()).toBe("2026-02-10T12:00:05.000Z");
  });

  it("starts interval cadence changes from now when the schedule has never run", async () => {
    const nowMs = Date.parse("2026-02-10T12:00:00.000Z");
    jest.useFakeTimers().setSystemTime(nowMs);

    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await persistActiveIntervalSchedule(store, {
      id: "s2",
      workflowKey: "task-b",
      type: "interval",
      pattern: "29000",
      input: { version: 1 },
      status: "active",
      createdAt: new Date(nowMs - 19_000),
      updatedAt: new Date(nowMs - 19_000),
      nextRun: new Date(nowMs + 10_000),
    });

    await service.updateSchedule("s2", { interval: 5_000 });

    const updated = await store.getSchedule("s2");
    const timer = (await futureTimers(store)).find(
      (entry) => entry.id === "sched:s2",
    );

    expect(updated?.pattern).toBe("5000");
    expect(updated?.nextRun?.toISOString()).toBe("2026-02-10T12:00:05.000Z");
    expect(timer?.fireAt.toISOString()).toBe("2026-02-10T12:00:05.000Z");
  });
});
