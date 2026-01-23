import { AsyncLocalStorage } from "node:async_hooks";
import { DurableContext } from "../../durable/core/DurableContext";
import { DurableResource } from "../../durable/core/DurableResource";
import type { IDurableContext } from "../../durable/core/interfaces/context";
import type { IDurableService } from "../../durable/core/interfaces/service";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { event, r } from "../../..";

/**
 * Creates a mock IDurableService for testing. Uses properly-typed functions
 * that satisfy the generic constraints of the interface.
 */
function createMockService(
  spied = false,
): IDurableService & { [K in keyof IDurableService]: jest.Mock } {
  // Generic methods need to return a value compatible with Promise<TResult>
  // Using "ok" as the mock value works because the test code casts appropriately
  const mockFn = spied
    ? <T>(val: T) => jest.fn().mockResolvedValue(val)
    : <T>(val: T) => jest.fn(async () => val);

  return {
    startExecution: mockFn("e1"),
    wait: mockFn("ok"),
    execute: mockFn("ok"),
    executeStrict: mockFn("ok"),
    schedule: mockFn("sched1"),
    ensureSchedule: mockFn("sched1"),
    pauseSchedule: mockFn(undefined),
    resumeSchedule: mockFn(undefined),
    getSchedule: mockFn(null),
    listSchedules: mockFn([]),
    updateSchedule: mockFn(undefined),
    removeSchedule: mockFn(undefined),
    recover: mockFn(undefined),
    signal: mockFn(undefined),
    start: jest.fn(),
    stop: mockFn(undefined),
    // Cast is necessary because generic methods like wait<TResult>() can't be
    // satisfied by a mock returning a concrete type - this is a known TypeScript limitation
  } as IDurableService & { [K in keyof IDurableService]: jest.Mock };
}

describe("durable: DurableResource", () => {
  it("throws when use() is called outside a durable execution", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.use()).toThrow(
      "Durable context is not available. Did you call durable.use() outside a durable task execution?",
    );
  });

  it("proxies durable methods to the underlying service and exposes a scoped use()", async () => {
    const service = createMockService(true);

    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    const task = r
      .task("durable.tests.resource.task")
      .run(async (_input: { a: number }) => "ok")
      .build();
    const signalDef = event<{ a: number }>({
      id: "durable.tests.resource.signal",
    });

    expect(await durable.startExecution(task, { a: 1 })).toBe("e1");
    expect(service.startExecution).toHaveBeenCalledWith(
      task,
      { a: 1 },
      undefined,
    );

    expect(await durable.wait<string>("e1")).toBe("ok");
    expect(service.wait).toHaveBeenCalledWith("e1", undefined);

    expect(await durable.execute(task, { a: 1 })).toBe("ok");
    expect(service.execute).toHaveBeenCalledWith(task, { a: 1 }, undefined);

    expect(await durable.executeStrict(task, { a: 1 })).toBe("ok");
    expect(service.executeStrict).toHaveBeenCalledWith(
      task,
      { a: 1 },
      undefined,
    );

    expect(await durable.schedule(task, { a: 1 }, { delay: 1 })).toBe("sched1");
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
