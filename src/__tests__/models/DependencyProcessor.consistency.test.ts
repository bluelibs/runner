import { r } from "../../index";
import { run } from "../../run";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { createTestFixture } from "../test-utils";
import { createMessageError } from "../../errors";

enum ResourceId {
  Broken = "broken.resource",
  BrokenWithMeta = "broken.resource.meta",
  BrokenViaDependency = "broken.resource.dependency",
  Root = "root",
  Task = "task",
  Resource = "res",
  Service = "service",
  Event = "event",
  Hook = "hook",
  Emitter = "emitter",
  Consumer = "consumer",
  DependencyTask = "task.dependency",
  TaskConsumer = "resource.taskConsumer",
  TaskInitConsumer = "resource.taskInitConsumer",
}

enum ErrorMessage {
  Boom = "boom",
  WithResource = "broken.resource.meta boom",
}

describe("DependencyProcessor Consistency", () => {
  it("should rethrow non-Error resource init failures with a helpful message", async () => {
    const broken = r
      .resource(ResourceId.Broken)
      .init(async () => {
        throw ErrorMessage.Boom;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    await expect(run(root)).rejects.toThrow(
      /Resource "broken\.resource" initialization failed: boom/,
    );
  });

  it("should annotate Error failures with resourceId and cause", async () => {
    const error = new Error(ErrorMessage.Boom);
    const broken = r
      .resource(ResourceId.Broken)
      .init(async () => {
        throw error;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    let caught: unknown;
    try {
      await run(root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const caughtError = caught as Error;
    expect(caughtError.message).toContain(ResourceId.Broken);
    expect(Reflect.get(caughtError, "resourceId")).toBe(ResourceId.Broken);
    expect(Reflect.get(caughtError, "cause")).toEqual({
      resourceId: ResourceId.Broken,
    });
  });

  it("should keep existing resourceId and cause when present", async () => {
    const error = new Error(ErrorMessage.WithResource);
    Object.defineProperty(error, "resourceId", {
      value: ResourceId.BrokenWithMeta,
      configurable: true,
    });
    Object.defineProperty(error, "cause", {
      value: { resourceId: ResourceId.BrokenWithMeta },
      configurable: true,
    });

    const broken = r
      .resource(ResourceId.BrokenWithMeta)
      .init(async () => {
        throw error;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    let caught: unknown;
    try {
      await run(root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const caughtError = caught as Error;
    expect(caughtError.message).toBe(ErrorMessage.WithResource);
    expect(Reflect.get(caughtError, "resourceId")).toBe(
      ResourceId.BrokenWithMeta,
    );
    expect(Reflect.get(caughtError, "cause")).toEqual({
      resourceId: ResourceId.BrokenWithMeta,
    });
  });

  // Regression test for: https://github.com/bluelibs/runner/issues/BUG-ID-OR-CONTEXT
  it("should preserve task wrapper identity between injection and storage", async () => {
    const task = r
      .task(ResourceId.Task)
      .run(async () => "bar")
      .build();

    const resource = r
      .resource(ResourceId.Resource)
      .dependencies({ task })
      .init(async (_config, { task }) => {
        return { task };
      })
      .build();

    // Root depends on resource to force earlier initialization, which previously triggered the inconsistency
    const root = r
      .resource(ResourceId.Root)
      .register([task, resource])
      .dependencies({ resource })
      .init(async () => "root")
      .build();

    const runtime = await run(root);
    const resEntry = runtime.store.resources.get(resource.id);

    const injectedTask = resEntry?.value.task;
    const storedTask = (resEntry?.computedDependencies as any)?.task;

    // This ensures that the task wrapper used during initialization is the EXACT same object
    // as the one stored in computedDependencies.
    expect(injectedTask).toBeDefined();
    expect(storedTask).toBeDefined();
    expect(injectedTask).toBe(storedTask);

    await runtime.dispose();
  });

  it("should initialize hook dependencies before early event emissions", async () => {
    const seen: number[] = [];

    const event = r.event<{ ok: true }>(ResourceId.Event).build();

    const service = r
      .resource(ResourceId.Service)
      .init(async () => ({ value: 42 }))
      .build();

    const hook = r
      .hook(ResourceId.Hook)
      .on(event)
      .dependencies({ service })
      .run(async (_input, { service }) => {
        seen.push(service.value);
      })
      .build();

    const emitter = r
      .resource(ResourceId.Emitter)
      .dependencies({ event })
      .init(async (_config, { event }) => {
        await event({ ok: true });
        return "emitter";
      })
      .build();

    const consumer = r
      .resource(ResourceId.Consumer)
      .dependencies({ emitter })
      .init(async () => "consumer")
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([consumer, emitter, service, hook, event])
      .init(async () => "root")
      .build();

    const runtime = await run(root);
    expect(seen).toEqual([42]);
    await runtime.dispose();
  });

  it("should deliver events emitted while hook dependencies are still computing", async () => {
    const seen: string[] = [];

    const event = r.event<{ ok: true }>("hook.buffer.event").build();

    const earlyEmitter = r
      .resource("hook.buffer.emitter")
      .dependencies({ event })
      .init(async (_config, { event }) => {
        await event({ ok: true });
        await event({ ok: true });
        return "emitted";
      })
      .build();

    const secondaryDep = r
      .resource("hook.buffer.dep")
      .init(async () => ({ value: "dep" }))
      .build();

    const hookA = r
      .hook("hook.buffer.hookA")
      .on(event)
      .dependencies({ earlyEmitter })
      .run(async () => {
        seen.push("A");
      })
      .build();

    const hookB = r
      .hook("hook.buffer.hookB")
      .on(event)
      .dependencies({ secondaryDep })
      .run(async (_input, { secondaryDep }) => {
        seen.push(secondaryDep.value);
      })
      .build();

    const root = r
      .resource("hook.buffer.root")
      .register([hookA, hookB, earlyEmitter, secondaryDep, event])
      .init(async () => "root")
      .build();

    const runtime = await run(root);

    expect(seen).toHaveLength(4);
    expect(seen.filter((entry) => entry === "A")).toHaveLength(2);
    expect(seen.filter((entry) => entry === "dep")).toHaveLength(2);

    await runtime.dispose();
  });

  it("should use the store task definition when resolving early task dependencies", async () => {
    const service = r
      .resource(ResourceId.Service)
      .init(async () => ({ value: 7 }))
      .build();

    const task = r
      .task(ResourceId.DependencyTask)
      .dependencies(() => ({ service }))
      .run(async (_input, { service }) => service.value)
      .build();

    const taskConsumer = r
      .resource(ResourceId.TaskConsumer)
      .dependencies({ task })
      .init(async (_config, { task }) => {
        const value = await task(undefined);
        return { value };
      })
      .build();

    // Depends on taskConsumer so it gets initialized while dependencies
    // are still being traversed for other resources.
    const taskInitConsumer = r
      .resource(ResourceId.TaskInitConsumer)
      .dependencies({ taskConsumer })
      .init(async () => "ok")
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([taskInitConsumer, taskConsumer, service, task])
      .dependencies({ taskConsumer })
      .init(async (_config, { taskConsumer }) => taskConsumer.value)
      .build();

    const runtime = await run(root);
    expect(runtime.value).toBe(7);
    await runtime.dispose();
  });

  it("should annotate dependency-triggered resource initialization errors", async () => {
    const broken = r
      .resource(ResourceId.BrokenViaDependency)
      .init(async () => {
        throw createMessageError(ErrorMessage.Boom);
      })
      .build();

    const consumer = r
      .resource(ResourceId.Consumer)
      .dependencies({ broken })
      .init(async () => "consumer")
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([consumer, broken])
      .dependencies({ consumer })
      .init(async () => "root")
      .build();

    let caught: unknown;
    try {
      await run(root);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const caughtError = caught as Error;
    expect(caughtError.message).toContain(ResourceId.BrokenViaDependency);
    expect(Reflect.get(caughtError, "resourceId")).toBe(
      ResourceId.BrokenViaDependency,
    );
    expect(Reflect.get(caughtError, "cause")).toEqual({
      resourceId: ResourceId.BrokenViaDependency,
    });
  });

  it("should skip hook execution when dependencies are not ready yet", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const event = r.event<{ ok: true }>("hook.pending.event").build();
    const runHook = jest.fn(async () => undefined);
    const hook = r
      .hook("hook.pending.hook")
      .on(event)
      .run(async () => runHook())
      .build();
    const root = r
      .resource("hook.pending.root")
      .register([event, hook])
      .build();

    store.initializeStore(root, {}, runtimeResult);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );
    processor.attachListeners();

    await eventManager.emit(event, { ok: true }, "test");
    expect(runHook).not.toHaveBeenCalled();
  });

  it("covers buffered hook flush guards and self-source filtering", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );
    type HookEvent = { source: string; data: unknown };
    type HookStoreElementShape = {
      hook: { id: string; run: () => Promise<void> };
      computedDependencies: Record<string, never>;
      dependencyState: string;
    };
    type DependencyProcessorInternals = {
      flushBufferedHookEvents: (
        hookStoreElement: HookStoreElementShape,
      ) => Promise<void>;
      pendingHookEvents: Map<string, HookEvent[]>;
      drainingHookIds: Set<string>;
    };
    const internals = processor as unknown as DependencyProcessorInternals;

    const hook = {
      id: "test.hook.flush",
      run: jest.fn(async () => undefined),
    };
    const hookStoreElement = {
      hook,
      computedDependencies: {},
      dependencyState: "pending",
    };

    await expect(
      internals.flushBufferedHookEvents(hookStoreElement),
    ).resolves.toBeUndefined();

    hookStoreElement.dependencyState = "ready";
    internals.pendingHookEvents.set(hook.id, [{ source: "outside", data: {} }]);
    internals.drainingHookIds.add(hook.id);

    await expect(
      internals.flushBufferedHookEvents(hookStoreElement),
    ).resolves.toBeUndefined();
    expect(internals.pendingHookEvents.get(hook.id)).toHaveLength(1);

    internals.drainingHookIds.delete(hook.id);
    internals.pendingHookEvents.set(hook.id, [
      { source: hook.id, data: { skip: true } },
      { source: "outside", data: { run: true } },
    ]);

    const executeSpy = jest
      .spyOn(eventManager, "executeHookWithInterceptors")
      .mockResolvedValue(undefined);

    await internals.flushBufferedHookEvents(hookStoreElement);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      hook,
      expect.objectContaining({ source: "outside" }),
      {},
    );
  });
});
