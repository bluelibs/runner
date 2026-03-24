import { r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import type { Schedule, Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createTaskExecutor, okTask } from "./DurableService.unit.helpers";

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

describe("durable: DurableService — scheduling (unit)", () => {
  it("supports one-off and cron schedules", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t-sched")
      .run(async (_input: { a: number }) => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const onceId = await service.schedule(task, { a: 1 }, { delay: 5 });
    const readyOnce = await store.getReadyTimers(new Date(Date.now() + 1000));
    expect(readyOnce.some((t) => t.id === `once:${onceId}`)).toBe(true);

    const cronId = await service.schedule(
      task,
      { a: 1 },
      { id: "cron-1", cron: "*/5 * * * *" },
    );
    expect(cronId).toBe("cron-1");
    expect((await store.getSchedule("cron-1"))?.status).toBe("active");
  });

  it("supports schedule lifecycle helpers", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    // no-op for missing schedules
    await service.pauseSchedule("missing");
    await service.resumeSchedule("missing");

    const schedule: Schedule = {
      id: "s1",
      workflowKey: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      lastRun: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.createSchedule(schedule);

    await service.pauseSchedule("s1");
    expect((await store.getSchedule("s1"))?.status).toBe("paused");

    expect((await service.getSchedule("s1"))?.id).toBe("s1");
    expect((await service.listSchedules()).length).toBe(1);

    await service.resumeSchedule("s1");
    expect((await store.getSchedule("s1"))?.status).toBe("active");
    expect((await store.getSchedule("s1"))?.lastRun?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );

    await service.updateSchedule("s1", { input: { a: 1 } });
    expect((await store.getSchedule("s1"))?.pattern).toBe("1000");
    expect((await store.getSchedule("s1"))?.input).toEqual({ a: 1 });

    await service.removeSchedule("s1");
    expect(await store.getSchedule("s1")).toBeNull();
  });

  it("registers tasks provided via schedules config", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t-sched-task")
      .run(async (_input: unknown) => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      schedules: [{ id: "s1", task, interval: 1000, input: {} }],
    });

    expect(service.findTask(task.id)).toBeDefined();
  });

  it("resolves schedules that reference a task by string id", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t-sched-task-by-id")
      .run(async (_input: unknown) => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
      schedules: [{ id: "s1", task: task.id, interval: 1000, input: {} }],
    });

    expect(service.findTask(task.id)).toBe(task);
  });

  it("fails fast when schedules reference an unknown string task id", () => {
    const store = new MemoryStore();

    expect(
      () =>
        new DurableService({
          store,
          taskExecutor: createTaskExecutor({}),
          schedules: [
            { id: "s1", task: "missing-task", interval: 1000, input: {} },
          ],
        }),
    ).toThrow(
      'Cannot initialize durable schedule "s1": task "missing-task" is not registered.',
    );
  });

  it("creates interval-based schedules and updates intervals", async () => {
    const store = new MemoryStore();
    const task = okTask("t-interval");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const id = await service.schedule(task, undefined, {
      id: "s1",
      interval: 1000,
    });
    expect(id).toBe("s1");
    expect((await store.getSchedule("s1"))?.type).toBe("interval");

    await service.updateSchedule("s1", { interval: 2000 });
    expect((await store.getSchedule("s1"))?.pattern).toBe("2000");
  });

  it("keeps interval cadence anchored to the intended fire time instead of drifting from now", async () => {
    const store = new MemoryStore();
    const task = okTask("t-interval-anchor");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const scheduledNextRun = new Date(Date.now() - 250);
    await store.createSchedule({
      id: "s-anchor",
      workflowKey: task.id,
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "paused",
      createdAt: new Date(Date.now() - 5_000),
      updatedAt: new Date(Date.now() - 5_000),
      nextRun: scheduledNextRun,
      lastRun: new Date(scheduledNextRun.getTime() - 1_000),
    });

    await service.resumeSchedule("s-anchor");

    const updated = await store.getSchedule("s-anchor");
    expect(updated?.nextRun?.getTime()).toBe(
      scheduledNextRun.getTime() + 1_000,
    );
  });

  it("preserves cadence and pending fire time when only schedule input changes", async () => {
    const store = new MemoryStore();
    const task = r
      .task<{ version: number }>("t-update-input")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });

    const beforeTimer = (await futureTimers(store)).find(
      (t) => t.id === "sched:s1",
    );
    expect(beforeTimer).toBeDefined();

    await service.updateSchedule("s1", { input: { version: 2 } });

    const schedule = await store.getSchedule("s1");
    const afterTimer = (await futureTimers(store)).find(
      (t) => t.id === "sched:s1",
    );

    expect(schedule?.type).toBe("interval");
    expect(schedule?.pattern).toBe("1000");
    expect(schedule?.input).toEqual({ version: 2 });
    expect(afterTimer).toBeDefined();
    expect(afterTimer?.input).toEqual({ version: 2 });
    expect(afterTimer?.fireAt.getTime()).toBe(beforeTimer?.fireAt.getTime());
  });

  it("re-arms the schedule and updates its type when changing cadence", async () => {
    const store = new MemoryStore();
    const task = r
      .task<{ version: number }>("t-update-cadence")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });
    const beforeTimer = (await futureTimers(store)).find(
      (t) => t.id === "sched:s1",
    );
    expect(beforeTimer).toBeDefined();

    await service.updateSchedule("s1", { cron: "*/5 * * * *" });

    const schedule = await store.getSchedule("s1");
    const afterTimer = (await futureTimers(store)).find(
      (t) => t.id === "sched:s1",
    );
    expect(afterTimer).toBeDefined();

    expect(schedule?.type).toBe("cron");
    expect(schedule?.pattern).toBe("*/5 * * * *");
    expect(afterTimer?.fireAt.getTime()).not.toBe(
      beforeTimer?.fireAt.getTime(),
    );
    expect(afterTimer?.fireAt.getTime()).toBe(schedule?.nextRun?.getTime());
  });

  it("allows clearing scheduled input and no-ops when updating a missing schedule", async () => {
    const store = new MemoryStore();
    const task = r
      .task<{ version: number }>("t-update-clear-input")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });
    await service.updateSchedule("s1", { input: undefined });
    await service.updateSchedule("missing", { input: { version: 2 } });

    const schedule = await store.getSchedule("s1");
    expect(schedule?.input).toBeUndefined();
    expect(schedule?.pattern).toBe("1000");
  });

  it("updates paused schedules without re-arming their timer", async () => {
    const store = new MemoryStore();
    const task = r
      .task<{ version: number }>("t-update-paused")
      .run(async () => "ok")
      .build();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    await service.schedule(task, { version: 1 }, { id: "s1", interval: 1000 });
    await service.pauseSchedule("s1");
    await service.updateSchedule("s1", { input: { version: 2 } });

    const schedule = await store.getSchedule("s1");
    const timer = (await futureTimers(store)).find(
      (entry) => entry.id === "sched:s1",
    );

    expect(schedule?.status).toBe("paused");
    expect(schedule?.input).toEqual({ version: 2 });
    expect(timer?.input).toEqual({ version: 1 });
  });

  it("updates active schedules without nextRun metadata without arming a timer", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
    });

    await store.createSchedule({
      id: "s1",
      workflowKey: "t",
      type: "interval",
      pattern: "1000",
      input: { version: 1 },
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.updateSchedule("s1", { input: { version: 2 } });

    const schedule = await store.getSchedule("s1");
    const timer = (await futureTimers(store)).find(
      (entry) => entry.id === "sched:s1",
    );

    expect(schedule?.input).toEqual({ version: 2 });
    expect(timer).toBeUndefined();
  });

  it("supports scheduling at a fixed date", async () => {
    const store = new MemoryStore();
    const task = okTask("t-at");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({}),
      tasks: [task],
    });

    const at = new Date(Date.now() + 1000);
    const id = await service.schedule(task, undefined, { id: "once-at", at });
    expect(id).toBe("once-at");

    const timers = await store.getReadyTimers(new Date(Date.now() + 2000));
    expect(timers.some((t) => t.id === "once:once-at")).toBe(true);
  });
});
