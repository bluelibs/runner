import { AsyncLocalStorage } from "node:async_hooks";
import { r } from "../../../../..";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { DurableResource } from "../../../../durable/core/DurableResource";
import { DurableService } from "../../../../durable/core/DurableService";
import type { Schedule, Timer } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

function futureTimers(store: IDurableStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

function createNoLockStore(base: MemoryStore): IDurableStore {
  return createBareStore(base);
}

describe("ensureSchedule()", () => {
  it("creates a new cron schedule and arms a stable schedule timer id", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-cron")
      .run(async (_input: { a: number }) => "ok")
      .build();

    await expect(
      service.ensureSchedule(task, { a: 1 }, { id: "s1", cron: "*/5 * * * *" }),
    ).resolves.toBe("s1");

    const schedule = await store.getSchedule("s1");
    expect(schedule).not.toBeNull();
    expect(schedule?.workflowKey).toBe(task.id);
    expect(schedule?.type).toBe("cron");
    expect(schedule?.pattern).toBe("*/5 * * * *");
    expect(schedule?.status).toBe("active");
    expect(schedule?.nextRun).toBeInstanceOf(Date);

    const timers = await futureTimers(store);
    expect(timers.some((t) => t.id === "sched:s1")).toBe(true);
  });

  it("persists timezone for cron schedules created via ensureSchedule()", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-cron-timezone")
      .run(async () => "ok")
      .build();

    await service.ensureSchedule(task, undefined, {
      id: "s1",
      cron: "0 9 * * *",
      timezone: "UTC",
    });

    expect((await store.getSchedule("s1"))?.timezone).toBe("UTC");
  });

  it("updates an existing schedule (same id/task) and re-arms its timer", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-update")
      .run(async (_input: { v: number }) => "ok")
      .build();

    await service.ensureSchedule(task, { v: 1 }, { id: "s1", interval: 1000 });
    const first = (await store.getSchedule("s1")) as Schedule;
    expect(first.pattern).toBe("1000");

    await service.ensureSchedule(task, { v: 2 }, { id: "s1", interval: 2000 });
    const updated = (await store.getSchedule("s1")) as Schedule;
    expect(updated.pattern).toBe("2000");
    expect(updated.input).toEqual({ v: 2 });

    const timers = await futureTimers(store);
    const timer = timers.find((t) => t.id === "sched:s1");
    expect(timer?.scheduleId).toBe("s1");
  });

  it("replaces timezone when ensureSchedule() updates an existing cron schedule", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-timezone-update")
      .run(async () => "ok")
      .build();

    await service.ensureSchedule(task, undefined, {
      id: "s1",
      cron: "0 9 * * *",
      timezone: "UTC",
    });
    await service.ensureSchedule(task, undefined, {
      id: "s1",
      cron: "0 9 * * *",
      timezone: "America/New_York",
    });

    expect((await store.getSchedule("s1"))?.timezone).toBe("America/New_York");
  });

  it("rejects rebinding an existing schedule id to a different workflow", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const a = r
      .task("t-ensure-a")
      .run(async () => "ok")
      .build();
    const b = r
      .task("t-ensure-b")
      .run(async () => "ok")
      .build();

    await service.ensureSchedule(a, undefined, { id: "s1", interval: 1000 });
    await expect(
      service.ensureSchedule(b, undefined, { id: "s1", interval: 1000 }),
    ).rejects.toThrow("cannot rebind");
  });

  it("throws when ensureSchedule() is called without cron/interval", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-invalid")
      .run(async () => "ok")
      .build();

    await expect(
      service.ensureSchedule(task, undefined, { id: "s1" } as {
        id: string;
        cron: string;
      }),
    ).rejects.toThrow("requires cron or interval");
  });

  it("works without store locks (best-effort)", async () => {
    const base = new MemoryStore();
    const store = createNoLockStore(base);
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-nolock")
      .run(async () => "ok")
      .build();

    await expect(
      service.ensureSchedule(task, undefined, { id: "s1", interval: 1000 }),
    ).resolves.toBe("s1");
  });

  it("fails fast when schedule timer arming is attempted without nextRun", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const scheduleManager = (
      service as unknown as {
        scheduleManager: {
          saveScheduleWithTimer: (schedule: Schedule) => Promise<void>;
        };
      }
    ).scheduleManager;

    await expect(
      scheduleManager.saveScheduleWithTimer({
        id: "s-missing-next-run",
        workflowKey: "t-missing-next-run",
        input: undefined,
        pattern: "1000",
        type: "interval",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Schedule),
    ).rejects.toThrow("must have nextRun before arming its timer");
  });

  it("fails fast when the schedule lock cannot be acquired", async () => {
    class LockedStore extends MemoryStore {
      override async acquireLock(): Promise<string | null> {
        return null;
      }
      override async releaseLock(): Promise<void> {}
    }

    const store = new LockedStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-locked")
      .run(async () => "ok")
      .build();

    await expect(
      service.ensureSchedule(task, undefined, { id: "s1", interval: 1000 }),
    ).rejects.toThrow("schedule lock");
  });

  it("delegates through DurableResource.ensureSchedule()", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const durable = new DurableResource(service, new AsyncLocalStorage());
    const task = r
      .task("t-ensure-resource")
      .run(async () => "ok")
      .build();

    await expect(
      durable.ensureSchedule(task, undefined, { id: "s1", interval: 1000 }),
    ).resolves.toBe("s1");
    expect((await store.getSchedule("s1"))?.workflowKey).toBe(task.id);
  });

  it("does not re-arm when the updated schedule cannot be reloaded", async () => {
    class FlakyStore extends MemoryStore {
      private getCalls = 0;

      override async getSchedule(id: string) {
        this.getCalls += 1;
        if (id === "s1" && this.getCalls >= 3) {
          return null;
        }
        return await super.getSchedule(id);
      }
    }

    const store = new FlakyStore();
    const service = new DurableService({ store, tasks: [] });
    const task = r
      .task("t-ensure-flaky")
      .run(async () => "ok")
      .build();

    await service.ensureSchedule(task, undefined, { id: "s1", interval: 1000 });
    await expect(
      service.ensureSchedule(task, undefined, { id: "s1", interval: 2000 }),
    ).resolves.toBe("s1");
  });
});
