import { defineHook, defineResource } from "../../define";
import { createTestFixture } from "../test-utils";
import { OverrideManager } from "../../models/OverrideManager";

describe("OverrideManager override graph recursion", () => {
  it("handles cyclic override references without overflowing the call stack", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    const first = defineResource({
      id: "override.cycle.first",
      overrides: [],
    });

    const second = defineResource({
      id: "override.cycle.second",
      overrides: [first],
    });

    first.overrides = [second];

    const root = defineResource({
      id: "override.cycle.root",
      register: [first, second],
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).not.toThrow();
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
    manager.overrides.set(hookOverride.id, hookOverride as any);

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
    manager2.overrides.set(missingHookOverride.id, missingHookOverride as any);
    manager2.overrideRequests.add({
      source: "source.matching",
      override: missingHookOverride as any,
    });
    manager2.overrideRequests.add({
      source: "source.unrelated",
      override: unrelatedOverride as any,
    });

    expect(() => manager2.processOverrides()).toThrow(
      /override\.hook\.missing/,
    );
  });
});
