import { AsyncLocalStorage } from "node:async_hooks";
import { DurableContext } from "../../durable/core/DurableContext";
import { DurableResource } from "../../durable/core/DurableResource";
import type { IDurableContext } from "../../durable/core/interfaces/context";
import type { IDurableService } from "../../durable/core/interfaces/service";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { event, r } from "../../..";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";

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
    start: mockFn("e1"),
    wait: mockFn("ok"),
    startAndWait: mockFn({ durable: { executionId: "e1" }, data: "ok" }),
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
    stop: mockFn(undefined),
    // Cast is necessary because generic methods like wait<TResult>() can't be
    // satisfied by a mock returning a concrete type - this is a known TypeScript limitation
  } as IDurableService & { [K in keyof IDurableService]: jest.Mock };
}

describe("durable: DurableResource", () => {
  it("operator throws when store is not available", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.operator).toThrow(
      "Durable operator API is not available: store was not provided to DurableResource.",
    );
  });

  it("operator is store-backed and cached", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();
    const durable = new DurableResource(service, storage, store);

    const op1 = durable.operator;
    const op2 = durable.operator;
    expect(op1).toBe(op2);

    await expect(op1.getExecutionDetail("e1")).resolves.toEqual({
      execution: null,
      steps: [],
      audit: [],
    });
  });

  it("throws when use() is called outside a durable execution", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.use()).toThrow(
      "Durable context is not available. Did you call durable.use() outside a durable task execution?",
    );
  });

  it("throws when describe() is called without runner store", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    const task = r
      .task("durable.tests.resource.describe.task")
      .run(async () => "ok")
      .build();

    await expect(durable.describe(task)).rejects.toThrow(
      "Durable describe API is not available: runner store was not provided to DurableResource.",
    );
  });

  it("throws when getWorkflows() is called without runner store", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.getWorkflows()).toThrow(
      "Durable workflow discovery is not available: runner store was not provided to DurableResource.",
    );
  });

  it("getWorkflows() returns tasks tagged with durable.workflow", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();

    const taggedTask = r
      .task("durable.tests.resource.tagged")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();

    const untaggedTask = r
      .task("durable.tests.resource.untagged")
      .run(async () => "ok")
      .build();

    const runnerStore = {
      getTasksWithTag: jest
        .fn()
        .mockImplementation((tag) =>
          tag.id === durableWorkflowTag.id ? [taggedTask] : [untaggedTask],
        ),
    } as any;

    const durable = new DurableResource(
      service,
      storage,
      undefined,
      runnerStore,
    );

    expect(durable.getWorkflows()).toEqual([taggedTask]);
    expect(runnerStore.getTasksWithTag).toHaveBeenCalledWith(
      durableWorkflowTag,
    );
  });

  it("throws when describe() is called and dependencies are missing in runner store", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const task = r
      .task("durable.tests.resource.describe.task.missing-deps")
      .run(async () => "ok")
      .build();

    const runnerStore = {
      tasks: new Map([[task.id, { task }]]),
    } as any;
    const durable = new DurableResource(
      service,
      storage,
      undefined,
      runnerStore,
    );

    await expect(durable.describe(task)).rejects.toThrow(
      'Cannot describe task "durable.tests.resource.describe.task.missing-deps": task dependencies are not available in the runtime store.',
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

    expect(await durable.start(task, { a: 1 })).toBe("e1");
    expect(service.start).toHaveBeenCalledWith(task, { a: 1 }, undefined);
    expect(await durable.start(task.id, { a: 2 })).toBe("e1");
    expect(service.start).toHaveBeenCalledWith(task.id, { a: 2 }, undefined);

    expect(await durable.wait<string>("e1")).toBe("ok");
    expect(service.wait).toHaveBeenCalledWith("e1", undefined);

    expect(await durable.startAndWait(task, { a: 1 })).toEqual({
      durable: { executionId: "e1" },
      data: "ok",
    });
    expect(service.startAndWait).toHaveBeenCalledWith(
      task,
      { a: 1 },
      undefined,
    );
    expect(await durable.startAndWait(task.id, { a: 2 })).toEqual({
      durable: { executionId: "e1" },
      data: "ok",
    });
    expect(service.startAndWait).toHaveBeenCalledWith(
      task.id,
      { a: 2 },
      undefined,
    );

    expect(await durable.schedule(task, { a: 1 }, { delay: 1 })).toBe("sched1");
    expect(service.schedule).toHaveBeenCalledWith(task, { a: 1 }, { delay: 1 });
    expect(await durable.schedule(task.id, { a: 2 }, { delay: 2 })).toBe(
      "sched1",
    );
    expect(service.schedule).toHaveBeenCalledWith(
      task.id,
      { a: 2 },
      {
        delay: 2,
      },
    );
    expect(
      await durable.ensureSchedule(
        task.id,
        { a: 3 },
        { id: "s1", interval: 1 },
      ),
    ).toBe("sched1");
    expect(service.ensureSchedule).toHaveBeenCalledWith(
      task.id,
      { a: 3 },
      {
        id: "s1",
        interval: 1,
      },
    );

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
