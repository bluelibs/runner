import { AsyncLocalStorage } from "node:async_hooks";
import { DurableContext } from "../../durable/core/DurableContext";
import { DurableResource } from "../../durable/core/DurableResource";
import type { IDurableContext } from "../../durable/core/interfaces/context";
import type {
  IDurableService,
  RecoverReportType,
} from "../../durable/core/interfaces/service";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { defineEvent, r } from "../../..";
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

  const recoverReport: RecoverReportType = {
    scannedCount: 0,
    recoveredCount: 0,
    skippedCount: 0,
    failedCount: 0,
    recovered: [],
    skipped: [],
    failures: [],
  };

  return {
    cooldown: mockFn(undefined),
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
    recover: mockFn(recoverReport),
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
  });

  it("throws when use() is called outside a durable execution", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    expect(() => durable.use()).toThrow(
      "Durable context is not available. Did you call durable.use() outside a durable task execution?",
    );
  });

  it("throws when getRepository() is called without runner store", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();
    const durable = new DurableResource(service, storage, store);

    const task = r
      .task("durable-tests-resource-detail-task")
      .run(async () => "ok")
      .build();

    expect(() => durable.getRepository(task)).toThrow(
      "Durable repository API is not available: runner store was not provided to DurableResource.",
    );
  });

  it("throws when getRepository() is called without a store", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const task = r
      .task("durable-tests-resource-repository-no-store")
      .run(async () => "ok")
      .build();
    const durable = new DurableResource(service, storage, undefined, {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === task ? "app.tasks.no-store" : undefined,
        ),
    } as any);

    expect(() => durable.getRepository(task)).toThrow(
      "Durable repository API is not available: store was not provided to DurableResource.",
    );
  });

  it("throws when getRepository() receives an unregistered task reference", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();
    const durable = new DurableResource(service, storage, store, {
      resolveDefinitionId: jest.fn().mockReturnValue(undefined),
      tasks: new Map(),
    } as any);

    expect(() => durable.getRepository({} as any)).toThrow(
      "the task is not registered in the runtime store",
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
      .task("durable-tests-resource-tagged")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();

    const untaggedTask = r
      .task("durable-tests-resource-untagged")
      .run(async () => "ok")
      .build();

    const runnerStore = {
      getTagAccessor: jest.fn().mockImplementation((tag) => ({
        tasks:
          tag.id === durableWorkflowTag.id
            ? [{ definition: taggedTask }]
            : [{ definition: untaggedTask }],
      })),
    } as any;

    const durable = new DurableResource(
      service,
      storage,
      undefined,
      runnerStore,
    );

    expect(durable.getWorkflows()).toEqual([
      {
        ...taggedTask,
        path: taggedTask.id,
      },
    ]);
    expect(runnerStore.getTagAccessor).toHaveBeenCalledWith(durableWorkflowTag);
  });

  it("getRepository() is cached and finds typed execution records", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();

    const task = r
      .task("durable-tests-resource-detail-shortcut")
      .inputSchema<{ orderId: string }>({
        parse: (value: any) => value,
      })
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async (input: { orderId: string }) => ({
        orderId: input.orderId,
        ok: true as const,
      }))
      .build();

    const runnerStore = {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === task
            ? "app.tasks.durable-tests-resource-detail-shortcut"
            : undefined,
        ),
      tasks: new Map([
        ["app.tasks.durable-tests-resource-detail-shortcut", { task }],
      ]),
    } as any;

    await store.saveExecution({
      id: "e1",
      workflowKey: "app.tasks.durable-tests-resource-detail-shortcut",
      input: { orderId: "o-1" },
      status: "completed",
      result: { orderId: "o-1", ok: true as const },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "done",
      result: "ok",
      completedAt: new Date(),
    });

    const durable = new DurableResource(service, storage, store, runnerStore);
    const repository1 = durable.getRepository(task);
    const repository2 = durable.getRepository(task);
    const detail = await repository1.findOneOrFail({ id: "e1" });

    expect(runnerStore.resolveDefinitionId).toHaveBeenCalledWith(task);
    expect(repository1).toBe(repository2);
    expect(detail.execution).toEqual(
      expect.objectContaining({
        id: "e1",
        workflowKey: "app.tasks.durable-tests-resource-detail-shortcut",
        input: { orderId: "o-1" },
        result: { orderId: "o-1", ok: true },
      }),
    );
    expect(detail.steps.map((step) => step.stepId)).toEqual(["done"]);
  });

  it("getRepository() fails fast when the task is not tagged as a durable workflow", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();

    const requestedTask = r
      .task("durable-tests-resource-repository-requested")
      .run(async () => "ok")
      .build();

    const storeTask = {
      task: requestedTask,
    };
    const runnerStore = {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === requestedTask ? "app.tasks.requested" : undefined,
        ),
      tasks: new Map([["app.tasks.requested", storeTask]]),
    } as any;

    const durable = new DurableResource(service, storage, store, runnerStore);

    expect(() => durable.getRepository(requestedTask)).toThrow(
      'Cannot create a durable repository for task "app.tasks.requested": the task is not tagged with tags.durableWorkflow.',
    );
  });

  it("findTree() includes child subflows with execution details", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();

    const parentTask = r
      .task("durable-tests-resource-parent")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();
    const childTask = r
      .task("durable-tests-resource-child")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();

    const runnerStore = {
      resolveDefinitionId: jest.fn().mockImplementation((reference) => {
        if (reference === parentTask) {
          return "app.tasks.parent";
        }
        if (reference === childTask) {
          return "app.tasks.child";
        }
        return undefined;
      }),
      tasks: new Map([
        ["app.tasks.parent", { task: parentTask }],
        ["app.tasks.child", { task: childTask }],
      ]),
    } as any;

    await store.saveExecution({
      id: "parent-exec",
      workflowKey: "app.tasks.parent",
      input: undefined,
      status: "completed",
      result: "ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "app.tasks.child",
      parentExecutionId: "parent-exec",
      input: undefined,
      status: "completed",
      result: "child-ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "child-exec",
      stepId: "child-step",
      result: "done",
      completedAt: new Date(),
    });

    const durable = new DurableResource(service, storage, store, runnerStore);
    const repository = durable.getRepository(parentTask);
    const tree = await repository.findTree({ id: "parent-exec" });

    expect(tree).toHaveLength(1);
    expect(tree[0].execution.id).toBe("parent-exec");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].execution.id).toBe("child-exec");
    expect(tree[0].children[0].steps.map((step) => step.stepId)).toEqual([
      "child-step",
    ]);
  });

  it("repository equality queries filter results and findOne() returns null when missing", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();

    const task = r
      .task("durable-tests-resource-query-task")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();

    const runnerStore = {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === task ? "app.tasks.query" : undefined,
        ),
      tasks: new Map([["app.tasks.query", { task }]]),
    } as any;

    await store.saveExecution({
      id: "e1",
      workflowKey: "app.tasks.query",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "e2",
      workflowKey: "app.tasks.query",
      parentExecutionId: "parent",
      input: undefined,
      status: "completed",
      attempt: 2,
      maxAttempts: 2,
      createdAt: new Date(Date.now() + 1),
      updatedAt: new Date(Date.now() + 1),
      completedAt: new Date(Date.now() + 1),
    });

    const durable = new DurableResource(service, storage, store, runnerStore);
    const repository = durable.getRepository(task);

    await expect(repository.find({ status: "completed" })).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({
          id: "e2",
          parentExecutionId: "parent",
          attempt: 2,
        }),
      }),
    ]);
    await expect(repository.findOne({ id: "missing" })).resolves.toBeNull();
  });

  it("findOneOrFail() throws a useful error when nothing matches", async () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const store = new MemoryStore();

    const task = r
      .task("durable-tests-resource-find-one-or-fail")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();

    const runnerStore = {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === task ? "app.tasks.find-one-or-fail" : undefined,
        ),
      tasks: new Map([["app.tasks.find-one-or-fail", { task }]]),
    } as any;

    const durable = new DurableResource(service, storage, store, runnerStore);

    await expect(
      durable.getRepository(task).findOneOrFail({ id: "missing" }),
    ).rejects.toThrow(
      'No durable execution matched task "app.tasks.find-one-or-fail" and query {"id":"missing"}.',
    );
  });

  it("fails fast when workflow discovery APIs are missing from the runner store", () => {
    const service = createMockService();
    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage, undefined, {} as any);

    expect(() => durable.getWorkflows()).toThrow(
      "Durable workflow discovery requires Store.getTagAccessor(tag).",
    );
  });

  it("proxies durable methods to the underlying service and exposes a scoped use()", async () => {
    const service = createMockService(true);

    const storage = new AsyncLocalStorage<IDurableContext>();
    const durable = new DurableResource(service, storage);

    const task = r
      .task("durable-tests-resource-task")
      .run(async (_input: { a: number }) => "ok")
      .build();
    const signalDef = defineEvent<{ a: number }>({
      id: "durable-tests-resource-signal",
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

    const recoverReport = await durable.recover();
    expect(recoverReport).toEqual({
      scannedCount: 0,
      recoveredCount: 0,
      skippedCount: 0,
      failedCount: 0,
      recovered: [],
      skipped: [],
      failures: [],
    });
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
