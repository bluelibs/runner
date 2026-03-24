import { r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import type { Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createTaskExecutor } from "./DurableService.unit.helpers";

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

describe("durable: DurableService — scheduling edge cases (unit)", () => {
  function createService() {
    const store = new MemoryStore();
    const task = r
      .task<{ version: number }>("t-scheduling-edge-cases")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    return { store, task, service };
  }

  it("does not reschedule already-active schedules on resume", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    const beforeTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );
    expect(beforeTimer).toBeDefined();

    await service.resumeSchedule("s1");

    const afterTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );
    expect(afterTimer).toBeDefined();
    expect(afterTimer?.fireAt.getTime()).toBe(beforeTimer?.fireAt.getTime());
  });

  it("does not reschedule when cadence updates resolve to the same effective cadence", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    const beforeTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );
    expect(beforeTimer).toBeDefined();

    await service.updateSchedule("s1", { interval: 1000 });

    const afterTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );
    expect(afterTimer).toBeDefined();
    expect(afterTimer?.fireAt.getTime()).toBe(beforeTimer?.fireAt.getTime());
  });

  it("fails fast for invalid interval updates without persisting schedule mutations", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    await expect(service.updateSchedule("s1", { interval: 0 })).rejects.toThrow(
      "invalid interval '0'",
    );

    const schedule = await store.getSchedule("s1");
    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
  });

  it("pre-validates cron updates before persisting schedule mutations", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    await expect(
      service.updateSchedule("s1", { cron: "not a cron expression" }),
    ).rejects.toThrow();

    const schedule = await store.getSchedule("s1");
    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
  });

  it("pre-validates cron timezone updates before persisting schedule mutations", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    await expect(
      service.updateSchedule("s1", {
        cron: "0 9 * * *",
        timezone: "Mars/Phobos",
      }),
    ).rejects.toThrow(/timezone/i);

    const schedule = await store.getSchedule("s1");
    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
    expect(schedule?.timezone).toBeUndefined();
  });

  it("fails fast when timezone is provided without cron", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    await expect(
      service.updateSchedule("s1", {
        timezone: "UTC",
      } as unknown as Parameters<typeof service.updateSchedule>[1]),
    ).rejects.toThrow(/cannot set timezone without cron/i);

    const schedule = await store.getSchedule("s1");
    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
    expect(schedule?.timezone).toBeUndefined();
  });

  it("fails fast when cron and interval are both provided", async () => {
    const { store, task, service } = createService();
    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    await expect(
      service.updateSchedule("s1", {
        cron: "0 9 * * *",
        interval: 1000,
      } as unknown as Parameters<typeof service.updateSchedule>[1]),
    ).rejects.toThrow(/cron or interval, not both/i);

    const schedule = await store.getSchedule("s1");
    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
  });

  it("updates paused cron schedules with timezone changes without re-arming timers", async () => {
    const { store, task, service } = createService();
    await service.schedule(
      task,
      { version: 1 },
      {
        id: "s1",
        cron: "0 9 * * *",
        timezone: "UTC",
      },
    );
    await service.pauseSchedule("s1");

    const beforeTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );
    expect(beforeTimer).toBeDefined();

    await service.updateSchedule("s1", {
      cron: "0 9 * * *",
      timezone: "America/New_York",
    });

    const schedule = await store.getSchedule("s1");
    const afterTimer = (await futureTimers(store)).find(
      (timer) => timer.id === "sched:s1",
    );

    expect(schedule?.status).toBe("paused");
    expect(schedule?.timezone).toBe("America/New_York");
    expect(afterTimer?.fireAt.getTime()).toBe(beforeTimer?.fireAt.getTime());
  });
});
