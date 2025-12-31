import { AsyncLocalStorage } from "node:async_hooks";
import { DurableContext } from "../core/DurableContext";
import { DurableResource } from "../core/DurableResource";
import type { IDurableContext } from "../core/interfaces/context";
import type { IDurableService } from "../core/interfaces/service";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";
import { event, r } from "../../..";

describe("durable: DurableResource", () => {
  it("throws when use() is called outside a durable execution", () => {
    const service = {
      startExecution: async () => "e1",
      wait: async () => "ok",
      execute: async () => "ok",
      executeStrict: async () => "ok",
      schedule: async () => "sched1",
      pauseSchedule: async () => undefined,
      resumeSchedule: async () => undefined,
      getSchedule: async () => null,
      listSchedules: async () => [],
      updateSchedule: async () => undefined,
      removeSchedule: async () => undefined,
      recover: async () => undefined,
      signal: async () => undefined,
      start: () => undefined,
      stop: async () => undefined,
    } satisfies IDurableService;
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.use()).toThrow(
      "Durable context is not available. Did you call durable.use() outside a durable task execution?",
    );
  });

  it("proxies durable methods to the underlying service and exposes a scoped use()", async () => {
    const service = {
      startExecution: jest.fn(async () => "e1"),
      wait: jest.fn(async () => "ok"),
      execute: jest.fn(async () => "ok"),
      executeStrict: jest.fn(async () => "ok"),
      schedule: jest.fn(async () => "sched1"),
      pauseSchedule: jest.fn(async () => undefined),
      resumeSchedule: jest.fn(async () => undefined),
      getSchedule: jest.fn(async () => null),
      listSchedules: jest.fn(async () => []),
      updateSchedule: jest.fn(async () => undefined),
      removeSchedule: jest.fn(async () => undefined),
      recover: jest.fn(async () => undefined),
      signal: jest.fn(async () => undefined),

      // not used by DurableResource, but required by the interface
      start: jest.fn(),
      stop: jest.fn(async () => undefined),
    } satisfies IDurableService;

    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    const task = r.task("durable.tests.resource.task").run(async () => "ok").build();
    const signalDef = event<{ a: number }>({ id: "durable.tests.resource.signal" });

    expect(await durable.startExecution(task, { a: 1 })).toBe("e1");
    expect(service.startExecution).toHaveBeenCalledWith(task, { a: 1 }, undefined);

    expect(await durable.wait<string>("e1")).toBe("ok");
    expect(service.wait).toHaveBeenCalledWith("e1", undefined);

    expect(await durable.execute(task, { a: 1 })).toBe("ok");
    expect(service.execute).toHaveBeenCalledWith(task, { a: 1 }, undefined);

    expect(await durable.executeStrict(task, { a: 1 })).toBe("ok");
    expect(service.executeStrict).toHaveBeenCalledWith(task, { a: 1 }, undefined);

    expect(
      await durable.schedule(task, { a: 1 }, { delay: 1 }),
    ).toBe("sched1");
    expect(service.schedule).toHaveBeenCalledWith(task, { a: 1 }, { delay: 1 });

    await durable.pauseSchedule("s1");
    expect(service.pauseSchedule).toHaveBeenCalledWith("s1");

    await durable.resumeSchedule("s1");
    expect(service.resumeSchedule).toHaveBeenCalledWith("s1");

    expect(await durable.getSchedule("s1")).toBeNull();
    expect(service.getSchedule).toHaveBeenCalledWith("s1");

    expect(await durable.listSchedules()).toEqual([]);
    expect(service.listSchedules).toHaveBeenCalledWith();

    await durable.updateSchedule("s1", { interval: 10 });
    expect(service.updateSchedule).toHaveBeenCalledWith("s1", { interval: 10 });

    await durable.removeSchedule("s1");
    expect(service.removeSchedule).toHaveBeenCalledWith("s1");

    await durable.recover();
    expect(service.recover).toHaveBeenCalledWith();

    await durable.signal("e1", signalDef, { a: 1 });
    expect(service.signal).toHaveBeenCalledWith("e1", signalDef, { a: 1 });

    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    storage.run(ctx, () => {
      expect(durable.use()).toBe(ctx);
    });
  });
});
