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
import { RunnerMode } from "../../types/runner";

describe("OverrideManager override graph recursion", () => {
  it("supports storeOverridesDeeply without explicitly passing a visited set", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override-default-visited-base",
      run: async () => "base",
    });
    const overrideTask = r.override(baseTask, async () => "override");

    const root = defineResource({
      id: "override-default-visited-root",
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
      id: "override-hook-base",
      on: "*",
      run: async () => undefined,
    });
    const hookOverride = defineHook({
      id: "override-hook-base",
      on: "*",
      run: async () => undefined,
    });

    const root = defineResource({
      id: "override-hook-root",
      register: [baseHook],
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    manager.overrides.set(hookOverride.id, hookOverride);

    expect(() => manager.processOverrides()).not.toThrow();
    expect(registry.hooks.has(hookOverride.id)).toBe(true);

    const missingHookOverride = defineHook({
      id: "override-hook-missing",
      on: "*",
      run: async () => undefined,
    });
    const unrelatedOverride = defineHook({
      id: "override-hook-unrelated",
      on: "*",
      run: async () => undefined,
    });

    const manager2 = new OverrideManager(registry);
    manager2.overrides.set(missingHookOverride.id, missingHookOverride);
    manager2.overrideRequests.push({
      source: "source-matching",
      override: missingHookOverride,
    });
    manager2.overrideRequests.push({
      source: "source-unrelated",
      override: unrelatedOverride,
    });

    expect(() => manager2.processOverrides()).toThrow(/override-hook-missing/);
  });

  it("fails fast when an unknown override shape is injected into the overrides map", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const root = defineResource({
      id: "override-unknown-shape-root",
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    manager.overrides.set("override-unknown-shape", {
      id: "override-unknown-shape",
    } as any);

    // Invalid shapes still get caught — the target won't be found in any registry.
    expect(() => manager.processOverrides()).toThrow(/override-unknown-shape/);
  });

  it("silently skips malformed entries in overrideRequests when collecting diagnostics", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const root = defineResource({
      id: "override-malformed-diag-root",
    });
    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);

    // Inject a valid-looking but unregistered override into the map.
    const fakeHook = defineHook({
      id: "override-malformed-diag-hook",
      on: "*",
      run: async () => undefined,
    });
    manager.overrides.set(fakeHook.id, fakeHook);

    // Push a malformed entry into overrideRequests to exercise the
    // toSupportedOverride error path inside getOverrideSourcesById.
    manager.overrideRequests.push({
      source: "malformed-source",
      override: { id: "not-a-real-type" } as any,
    });

    // processOverrides will throw (unregistered target). The malformed
    // overrideRequest is silently skipped during diagnostics collection.
    expect(() => manager.processOverrides()).toThrow(
      /override-malformed-diag-hook/,
    );
  });

  it("fails fast when two overrides target the same definition", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override-duplicate-target-base",
      run: async () => "base",
    });

    const overrideA = r.override(baseTask, async () => "a");
    const overrideB = r.override(baseTask, async () => "b");
    const root = defineResource({
      id: "override-duplicate-target-root",
      register: [baseTask],
      overrides: [overrideA, overrideB],
    });

    store.mode = RunnerMode.DEV;

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /declared more than once/,
    );
  });

  it("resolves duplicate targets to the outermost override in test mode", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override-duplicate-target-test-base",
      run: async () => "base",
    });

    const childOverride = r.override(baseTask, async () => "child");
    const rootOverride = r.override(baseTask, async () => "root");
    const child = defineResource({
      id: "override-duplicate-target-test-child",
      register: [baseTask],
      overrides: [childOverride],
    });
    const root = defineResource({
      id: "override-duplicate-target-test-root",
      register: [child],
      overrides: [rootOverride],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).not.toThrow();

    const registry = (store as any).registry as any;
    const targetId = registry.resolveDefinitionId(baseTask);
    expect(store.overrides.get(targetId)).toBe(rootOverride);
  });

  it("prefers an ancestor candidate when resolving test-mode winners", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const baseTask = defineTask({
      id: "override-winner-ancestor-base",
      run: async () => "base",
    });
    const childOverride = r.override(baseTask, async () => "child");
    const rootOverride = r.override(baseTask, async () => "root");
    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);

    jest
      .spyOn(registry.visibilityTracker, "isWithinResourceSubtree")
      .mockImplementation((sourceId: string, itemId: string) => {
        return sourceId === "root" && itemId === "child";
      });

    const winner = (manager as any).resolveWinningOverride("task", [
      { source: "child", override: childOverride },
      { source: "root", override: rootOverride },
    ]);

    expect(winner.override).toBe(rootOverride);
  });

  it("fails fast when test-mode duplicate sources are unrelated", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const baseTask = defineTask({
      id: "override-winner-unrelated-base",
      run: async () => "base",
    });
    const overrideA = r.override(baseTask, async () => "a");
    const overrideB = r.override(baseTask, async () => "b");
    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);

    jest
      .spyOn(registry.visibilityTracker, "isWithinResourceSubtree")
      .mockReturnValue(false);

    (manager as any).overrideCandidatesByTarget.set("task", [
      { source: "sibling-a", override: overrideA },
      { source: "sibling-b", override: overrideB },
    ]);

    expect(() =>
      (manager as any).resolveWinningOverride("task", [
        { source: "sibling-a", override: overrideA },
        { source: "sibling-b", override: overrideB },
      ]),
    ).toThrow(/declared more than once/);
  });

  it("fails fast when override target reference cannot be resolved", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const baseTask = defineTask({
      id: "override-unresolved-target-base",
      run: async () => "base",
    });

    const unresolvedOverride = {
      ...r.override(baseTask, async () => "override"),
      [symbolOverrideTargetDefinition]: {},
    } as any;

    const root = defineResource({
      id: "override-unresolved-target-root",
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
      id: "override-middleware-task-base",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "override-middleware-resource-base",
      run: async ({ next }) => next(),
    });
    const root = defineResource({
      id: "override-middleware-root",
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
      id: "override-visited-root",
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
      id: "override-parent-target-base",
      run: async () => "base",
    });
    const childOverride = r.override(baseTask, async () => "child");
    const child = defineResource({
      id: "override-parent-target-child",
      overrides: [childOverride],
    });
    const root = defineResource({
      id: "override-parent-target-root",
      register: [baseTask, child],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /outside that resource's registration subtree/,
    );
  });
});
