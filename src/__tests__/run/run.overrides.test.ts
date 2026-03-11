import {
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { r } from "../..";

describe("run-overrides", () => {
  it("should work with a simple override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = r.override(task, async () => "Task overridden");

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      overrides: [overrideTask],
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overridden");
  });

  it("should work with a deep override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = r.override(task, async () => "Task overridden");

    const middle = defineResource({
      id: "app",
      register: [task],
      overrides: [overrideTask],
    });

    const root = defineResource({
      id: "root",
      register: [middle],
      dependencies: { task },
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(root);
    expect(result.value).toBe("Task overridden");
  });

  it("should work with a deep override with config", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = r.override(task, async () => "Task overridden");

    const middle = defineResource<{ test: string }>({
      id: "app",
      register: [task],
      overrides: [overrideTask],
    });

    const root = defineResource({
      id: "root",
      register: [middle.with({ test: "ok" })],
      dependencies: { task },
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(root);
    expect(result.value).toBe("Task overridden");
  });

  it("should apply resource overrides while keeping registered config", async () => {
    const baseResource = defineResource<{ test: string }, Promise<string>>({
      id: "resource",
      init: async (config) => `base:${config.test}`,
    });

    const resourceOverride = r.override(
      baseResource,
      async (config) => `override:${config.test}`,
    );

    const app = defineResource({
      id: "app",
      register: [baseResource.with({ test: "base" })],
      overrides: [resourceOverride],
      dependencies: { baseResource },
      async init(_, deps) {
        return deps.baseResource;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("override:base");
  });

  it("should work overriding a middleware (task and resource)", async () => {
    const mw = defineTaskMiddleware({
      id: "middleware-task",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    const mwr = defineResourceMiddleware({
      id: "middleware-resource",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    const overrideMiddlewareTask = r.override(mw, async ({ next }) => {
      return `Overridden Middleware: ${await next()}`;
    });
    const overrideMiddlewareResource = r.override(mwr, async ({ next }) => {
      return `Overridden Middleware: ${await next()}`;
    });

    const task = defineTask({
      id: "task",
      middleware: [mw],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [mw, task, mwr],
      middleware: [mwr],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("Overridden Middleware: Task executed");
        return "Resource initialized";
      },
    });

    const wrapper = defineResource({
      id: "wrapper",
      register: [app],
      overrides: [overrideMiddlewareTask, overrideMiddlewareResource],
      dependencies: { app },
      async init(_, deps) {
        return deps.app;
      },
    });

    const result = await run(wrapper);
    expect(result.value).toBe("Overridden Middleware: Resource initialized");
  });

  it("should throw, when you try to override an unregistered task", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const missingTask = defineTask({
      id: "task2",
      run: async () => "Task overridden",
    });
    const missingTaskOverride = r.override(
      missingTask,
      async () => "Task overridden",
    );

    const app = defineResource({
      id: "app",
      dependencies: { task },
      overrides: [missingTaskOverride],
      async init(_, deps) {
        return await deps.task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Task "task2" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw when .overrides receives a configured override resource", async () => {
    const baseResource = defineResource<{ mode: string }, Promise<string>>({
      id: "configured-override-base",
      init: async (config) => config.mode,
    });
    const configuredOverride = r.override(
      baseResource,
      async (config) => `override:${config.mode}`,
    );

    const app = defineResource({
      id: "configured-override-app",
      register: [baseResource.with({ mode: "base" })],
      overrides: [configuredOverride.with({ mode: "override" }) as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / defineOverride(...).",
    );
  });

  it("should throw an override-specific error for unregistered resource overrides", async () => {
    const missingResource = defineResource({
      id: "missing-resource-override",
      init: async () => "base",
    });
    const missingResourceOverride = r.override(
      missingResource,
      async () => "override",
    );

    const app = defineResource({
      id: "app-missing-resource-override",
      overrides: [missingResourceOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Resource "missing-resource-override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered hook overrides", async () => {
    const hookEvent = defineTask({
      id: "missing-hook-override-event-task",
      run: async () => undefined,
    });
    const hookEventResource = defineResource({
      id: "missing-hook-override-event-resource",
      register: [hookEvent],
      dependencies: { hookEvent },
      init: async (_, deps) => deps.hookEvent,
    });
    const missingHook = defineHook({
      id: "missing-hook-override",
      on: "*",
      run: async () => undefined,
    });
    const missingHookOverride = r.override(missingHook, async () => undefined);

    const app = defineResource({
      id: "app-missing-hook-override",
      register: [hookEventResource],
      overrides: [missingHookOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Hook "missing-hook-override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered task middleware overrides", async () => {
    const missingMiddleware = defineTaskMiddleware({
      id: "missing-task-middleware-override",
      run: async ({ next }) => next(),
    });
    const missingMiddlewareOverride = r.override(
      missingMiddleware,
      async ({ next }) => next(),
    );

    const app = defineResource({
      id: "app-missing-task-middleware-override",
      overrides: [missingMiddlewareOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Task middleware "missing-task-middleware-override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered resource middleware overrides", async () => {
    const missingMiddleware = defineResourceMiddleware({
      id: "missing-resource-middleware-override",
      run: async ({ next }) => next(),
    });
    const missingMiddlewareOverride = r.override(
      missingMiddleware,
      async ({ next }) => next(),
    );

    const app = defineResource({
      id: "app-missing-resource-middleware-override",
      overrides: [missingMiddlewareOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Resource middleware "missing-resource-middleware-override" is not registered, so it cannot be overridden.',
    );
  });

  it("fails fast when a deep override target is not registered", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const missingTask = defineTask({
      id: "task2",
      run: async () => "Task overridden",
    });
    const missingTaskOverride = r.override(
      missingTask,
      async () => "Task overridden",
    );
    const override2 = r.override(task, async () => "Task super-overridden");

    const middle = defineResource({
      id: "app-middle",
      register: [task],
      overrides: [missingTaskOverride],
    });

    const app = defineResource({
      id: "app",
      dependencies: { task },
      register: [middle],
      overrides: [override2],
      async init(_, deps) {
        return await deps.task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Task "task2" is not registered',
    );
  });

  it("should override if I have a previously registered normal resource", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });
    const r2 = r.override(r1, async () => "Task overriden.");

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      register: [r1],
      overrides: [r2],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should override if I have a previously registered resource-with-config", async () => {
    const r1 = defineResource<{ name: string }, Promise<string>>({
      id: "override",
      init: async (config) => `Task executed ${config.name}`,
    });

    const r2 = r.override(
      r1,
      async (config) => `Task overriden ${config.name}.`,
    );

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      register: [r1.with({ name: "ok" })],
      overrides: [r2],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden ok.");
  });

  it("should override something deeply registered", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });

    const middle = defineResource({
      id: "app-m1",
      register: [r1],
    });

    const middle2 = defineResource({
      id: "app-m2",
      register: [middle],
    });

    const r2 = r.override(r1, async () => "Task overriden.");

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      register: [middle2],
      overrides: [r2],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should throw when .overrides receives a raw task definition", async () => {
    const baseTask = defineTask({
      id: "raw-task-base",
      run: async () => "base",
    });
    const rawTask = defineTask({
      id: "raw-task-base",
      run: async () => "raw",
    });

    const app = defineResource({
      id: "raw-task-app",
      register: [baseTask],
      overrides: [rawTask as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / defineOverride(...).",
    );
  });

  it("should throw when .overrides receives a raw resource-with-config", async () => {
    const baseResource = defineResource<{ mode: string }, Promise<string>>({
      id: "raw-resource-base",
      init: async (config) => config.mode,
    });
    const rawResource = defineResource<{ mode: string }, Promise<string>>({
      id: "raw-resource-base",
      init: async () => "raw",
    });

    const app = defineResource({
      id: "raw-resource-app",
      register: [baseResource.with({ mode: "base" })],
      overrides: [rawResource.with({ mode: "raw" }) as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / defineOverride(...).",
    );
  });

  it("should throw when .overrides receives a non-definition object", async () => {
    const baseTask = defineTask({
      id: "raw-object-base",
      run: async () => "base",
    });

    const app = defineResource({
      id: "raw-object-app",
      register: [baseTask],
      overrides: [{} as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / defineOverride(...).",
    );
  });

  it("should choose precedence when two overrides target the same id", async () => {
    const baseTask = defineTask({
      id: "task-same",
      run: async () => "Original",
    });

    const middleOverride = r.override(baseTask, async () => "Middle");
    const rootOverride = r.override(baseTask, async () => "Root");

    const middle = defineResource({
      id: "middle",
      register: [baseTask],
      overrides: [middleOverride],
    });

    const app = defineResource({
      id: "app",
      register: [middle],
      dependencies: { t: baseTask },
      overrides: [rootOverride],
      async init(_, deps) {
        return await deps.t();
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Override target "task-same" is declared more than once.',
    );
  });

  it("blocks overrides that try to replace a parent's registration", async () => {
    const baseTask = defineTask({
      id: "override-parent-owned-task",
      run: async () => "base",
    });

    const childOverride = r.override(baseTask, async () => "child");

    const child = defineResource({
      id: "override-parent-owned-child",
      overrides: [childOverride],
    });

    const app = defineResource({
      id: "override-parent-owned-app",
      register: [baseTask, child],
    });

    await expect(run(app)).rejects.toThrow(
      /cannot override Task "override-parent-owned-task" because it is outside that resource's registration subtree/,
    );
  });

  it("blocks overrides that target a sibling subtree", async () => {
    const siblingTask = defineTask({
      id: "override-sibling-task",
      run: async () => "base",
    });

    const sibling = defineResource({
      id: "override-sibling-owner",
      register: [siblingTask],
    });

    const childOverride = r.override(siblingTask, async () => "child");

    const otherChild = defineResource({
      id: "override-sibling-other-child",
      overrides: [childOverride],
    });

    const app = defineResource({
      id: "override-sibling-app",
      register: [sibling, otherChild],
    });

    await expect(run(app)).rejects.toThrow(
      /cannot override Task "override-sibling-task" because it is outside that resource's registration subtree/,
    );
  });

  it("still allows overrides declared from an ancestor resource", async () => {
    const baseTask = defineTask({
      id: "override-downstream-task",
      run: async () => "base",
    });

    const middle = defineResource({
      id: "override-downstream-middle",
      register: [baseTask],
    });

    const rootOverride = r.override(baseTask, async () => "root");

    const app = defineResource({
      id: "override-downstream-app",
      register: [middle],
      overrides: [rootOverride],
      dependencies: { task: baseTask },
      async init(_, deps) {
        return deps.task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("root");
    await result.dispose();
  });
});
