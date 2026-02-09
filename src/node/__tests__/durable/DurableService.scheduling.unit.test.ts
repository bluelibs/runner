import { r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import type { Schedule } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createTaskExecutor, okTask } from "./DurableService.unit.helpers";

describe("durable: DurableService — scheduling (unit)", () => {
  it("supports one-off and cron schedules", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sched")
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
      taskId: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
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

    await service.updateSchedule("s1", { input: { a: 1 } });
    expect((await store.getSchedule("s1"))?.pattern).toBeUndefined();

    await service.removeSchedule("s1");
    expect(await store.getSchedule("s1")).toBeNull();
  });

  it("registers tasks provided via schedules config", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.sched.task")
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
      .task("t.sched.task.by-id")
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
            { id: "s1", task: "missing.task", interval: 1000, input: {} },
          ],
        }),
    ).toThrow(
      'Cannot initialize durable schedule "s1": task "missing.task" is not registered.',
    );
  });

  it("creates interval-based schedules and updates intervals", async () => {
    const store = new MemoryStore();
    const task = okTask("t.interval");
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

  it("supports scheduling at a fixed date", async () => {
    const store = new MemoryStore();
    const task = okTask("t.at");
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
