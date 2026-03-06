import {
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { symbolOverrideTargetDefinition } from "../../defs";
import { createTestFixture } from "../test-utils";
import { OverrideManager } from "../../models/OverrideManager";
import { r } from "../..";

describe("OverrideManager override graph recursion", () => {
  it("supports storeOverridesDeeply without explicitly passing a visited set", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override.default-visited.base",
      run: async () => "base",
    });
    const overrideTask = r.override(baseTask, async () => "override");

    const root = defineResource({
      id: "override.default-visited.root",
      register: [baseTask],
      overrides: [overrideTask],
    });

    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    expect(() => manager.storeOverridesDeeply(root)).not.toThrow();
    const targetId = registry.resolveDefinitionId(baseTask);
    expect(manager.overrides.has(targetId)).toBe(true);
  });

  it("processes hook overrides and reports missing hook override targets with filtered sources", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseHook = defineHook({
      id: "override.hook.base",
      on: "*",
      run: async () => undefined,
    });
    const hookOverride = defineHook({
      id: "override.hook.base",
      on: "*",
      run: async () => undefined,
    });

    const root = defineResource({
      id: "override.hook.root",
      register: [baseHook],
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    manager.overrides.set(hookOverride.id, hookOverride);

    expect(() => manager.processOverrides()).not.toThrow();
    expect(registry.hooks.has(hookOverride.id)).toBe(true);

    const missingHookOverride = defineHook({
      id: "override.hook.missing",
      on: "*",
      run: async () => undefined,
    });
    const unrelatedOverride = defineHook({
      id: "override.hook.unrelated",
      on: "*",
      run: async () => undefined,
    });

    const manager2 = new OverrideManager(registry);
    manager2.overrides.set(missingHookOverride.id, missingHookOverride);
    manager2.overrideRequests.add({
      source: "source.matching",
      override: missingHookOverride,
    });
    manager2.overrideRequests.add({
      source: "source.unrelated",
      override: unrelatedOverride,
    });

    expect(() => manager2.processOverrides()).toThrow(
      /override\.hook\.missing/,
    );
  });

  it("fails fast when an unknown override shape is encountered during validation", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const root = defineResource({
      id: "override.unknown.shape.root",
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    manager.overrides.set("override.unknown.shape", {
      id: "override.unknown.shape",
    } as any);

    expect(() => manager.processOverrides()).toThrow(/Unknown item type/);
  });

  it("fails fast when an unknown override shape appears at store-write time", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override.unknown.shape.writer.base",
      run: async () => "base",
    });
    const root = defineResource({
      id: "override.unknown.shape.writer.root",
      register: [baseTask],
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const validOverride = defineTask({
      id: baseTask.id,
      run: async () => "override",
    });
    const invalidOverride = { id: "override.unknown.shape.writer.invalid" };

    const manager = new OverrideManager(registry);
    let valuesReadCount = 0;
    (manager.overrides as any).values = () => {
      valuesReadCount += 1;
      return valuesReadCount === 1
        ? [validOverride][Symbol.iterator]()
        : [invalidOverride][Symbol.iterator]();
    };

    expect(() => manager.processOverrides()).toThrow(/Unknown item type/);
  });

  it("fails fast when two overrides target the same definition", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override.duplicate.target.base",
      run: async () => "base",
    });

    const overrideA = r.override(baseTask, async () => "a");
    const overrideB = r.override(baseTask, async () => "b");
    const root = defineResource({
      id: "override.duplicate.target.root",
      register: [baseTask],
      overrides: [overrideA, overrideB],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /declared more than once/,
    );
  });

  it("fails fast when override target reference cannot be resolved", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override.unresolved.target.base",
      run: async () => "base",
    });

    const unresolvedOverride = {
      ...r.override(baseTask, async () => "override"),
      [symbolOverrideTargetDefinition]: {},
    } as any;

    const root = defineResource({
      id: "override.unresolved.target.root",
      register: [baseTask],
      overrides: [unresolvedOverride],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /not registered/i,
    );
  });

  it("processes task/resource middleware overrides", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const taskMiddleware = defineTaskMiddleware({
      id: "override.middleware.task.base",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "override.middleware.resource.base",
      run: async ({ next }) => next(),
    });
    const root = defineResource({
      id: "override.middleware.root",
      register: [taskMiddleware, resourceMiddleware],
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    manager.overrides.set(
      taskMiddleware.id,
      defineTaskMiddleware({
        id: taskMiddleware.id,
        run: async ({ next, task }) => next(task.input),
      }) as any,
    );
    manager.overrides.set(
      resourceMiddleware.id,
      defineResourceMiddleware({
        id: resourceMiddleware.id,
        run: async ({ next }) => next(),
      }) as any,
    );

    expect(() => manager.processOverrides()).not.toThrow();
    expect(registry.taskMiddlewares.has(taskMiddleware.id)).toBe(true);
    expect(registry.resourceMiddlewares.has(resourceMiddleware.id)).toBe(true);
  });

  it("returns early when override traversal revisits an already-visited resource", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const root = defineResource({
      id: "override.visited.root",
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    expect(() =>
      manager.storeOverridesDeeply(root, new Set([root.id])),
    ).not.toThrow();
    expect(manager.overrides.size).toBe(0);
  });

  it("fails fast when a child override targets a parent-owned definition", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override.parent.target.base",
      run: async () => "base",
    });
    const childOverride = r.override(baseTask, async () => "child");
    const child = defineResource({
      id: "override.parent.target.child",
      overrides: [childOverride],
    });
    const root = defineResource({
      id: "override.parent.target.root",
      register: [baseTask, child],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /outside that resource's registration subtree/,
    );
  });
});
