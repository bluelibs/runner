import {
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { createTestFixture } from "../test-utils";
import { OverrideManager } from "../../models/OverrideManager";
import { r } from "../..";

describe("OverrideManager override graph recursion", () => {
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
