import { defineHook, defineResource, defineTask } from "../../define";
import { createTestFixture } from "../test-utils";
import { OverrideManager } from "../../models/OverrideManager";

describe("OverrideManager override graph recursion", () => {
  it("handles cyclic override references without overflowing the call stack", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const firstBase = defineResource({
      id: "override.cycle.first",
      overrides: [],
    });

    const second = defineResource({
      id: "override.cycle.second",
      overrides: [firstBase],
    });

    const first = {
      ...firstBase,
      overrides: [second],
    } as typeof firstBase;

    const root = defineResource({
      id: "override.cycle.root",
      register: [first, second],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).not.toThrow();
  });

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
    const overrideTask = defineTask({
      id: "override.default-visited.base",
      run: async () => "override",
    });

    const root = defineResource({
      id: "override.default-visited.root",
      register: [baseTask],
      overrides: [overrideTask],
    });

    store.initializeStore(root, {}, runtimeResult);

    const registry = (store as any).registry as any;
    const manager = new OverrideManager(registry);
    expect(() => manager.storeOverridesDeeply(root)).not.toThrow();
    expect(manager.overrides.has(baseTask.id)).toBe(true);
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
});
