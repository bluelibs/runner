import {
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { r } from "../..";

describe("run.overrides", () => {
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

  it("should apply resource overrides with config via .with()", async () => {
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
      overrides: [resourceOverride.with({ test: "override" })],
      dependencies: { baseResource },
      async init(_, deps) {
        return deps.baseResource;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("override:override");
  });

  it("should work overriding a middleware (task and resource)", async () => {
    const mw = defineTaskMiddleware({
      id: "middleware.task",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    const mwr = defineResourceMiddleware({
      id: "middleware.resource",
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

  it("should throw, when you try to override something unregistered but with resources with config", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });
    const r2 = defineResource({
      id: "override2",
      init: async () => "Task executed",
    });
    const r2Override = r.override(r2, async () => "Task overridden");

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      overrides: [r2Override.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Resource "override2" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered resource overrides", async () => {
    const missingResource = defineResource({
      id: "missing.resource.override",
      init: async () => "base",
    });
    const missingResourceOverride = r.override(
      missingResource,
      async () => "override",
    );

    const app = defineResource({
      id: "app.missing.resource.override",
      overrides: [missingResourceOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Resource "missing.resource.override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered hook overrides", async () => {
    const hookEvent = defineTask({
      id: "missing.hook.override.event.task",
      run: async () => undefined,
    });
    const hookEventResource = defineResource({
      id: "missing.hook.override.event.resource",
      register: [hookEvent],
      dependencies: { hookEvent },
      init: async (_, deps) => deps.hookEvent,
    });
    const missingHook = defineHook({
      id: "missing.hook.override",
      on: "*",
      run: async () => undefined,
    });
    const missingHookOverride = r.override(missingHook, async () => undefined);

    const app = defineResource({
      id: "app.missing.hook.override",
      register: [hookEventResource],
      overrides: [missingHookOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Hook "missing.hook.override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered task middleware overrides", async () => {
    const missingMiddleware = defineTaskMiddleware({
      id: "missing.task.middleware.override",
      run: async ({ next }) => next(),
    });
    const missingMiddlewareOverride = r.override(
      missingMiddleware,
      async ({ next }) => next(),
    );

    const app = defineResource({
      id: "app.missing.task.middleware.override",
      overrides: [missingMiddlewareOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Task middleware "missing.task.middleware.override" is not registered, so it cannot be overridden.',
    );
  });

  it("should throw an override-specific error for unregistered resource middleware overrides", async () => {
    const missingMiddleware = defineResourceMiddleware({
      id: "missing.resource.middleware.override",
      run: async ({ next }) => next(),
    });
    const missingMiddlewareOverride = r.override(
      missingMiddleware,
      async ({ next }) => next(),
    );

    const app = defineResource({
      id: "app.missing.resource.middleware.override",
      overrides: [missingMiddlewareOverride],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      'Override target Resource middleware "missing.resource.middleware.override" is not registered, so it cannot be overridden.',
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
      id: "app.middle",
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

  it("should override if I have a previously registered normal resource with a resource with config", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });
    const r2 = r.override(r1, async () => "Task overriden.");

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      register: [r1],
      overrides: [r2.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should override if I have a previously registered resource-with-config with another resource-with-config", async () => {
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
      overrides: [r2.with({ name: "ok" })],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden ok.");
  });

  it("should override something deeply registered, with a with config", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });

    const middle = defineResource({
      id: "app.m1",
      register: [r1],
    });

    const middle2 = defineResource({
      id: "app.m2",
      register: [middle],
    });

    const r2 = r.override(r1, async () => "Task overriden.");

    const app = defineResource({
      id: "app",
      dependencies: { r1 },
      register: [middle2],
      overrides: [r2.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should throw when .overrides receives a raw task definition", async () => {
    const baseTask = defineTask({
      id: "raw.task.base",
      run: async () => "base",
    });
    const rawTask = defineTask({
      id: "raw.task.base",
      run: async () => "raw",
    });

    const app = defineResource({
      id: "raw.task.app",
      register: [baseTask],
      overrides: [rawTask as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / override(...).",
    );
  });

  it("should throw when .overrides receives a raw resource-with-config", async () => {
    const baseResource = defineResource<{ mode: string }, Promise<string>>({
      id: "raw.resource.base",
      init: async (config) => config.mode,
    });
    const rawResource = defineResource<{ mode: string }, Promise<string>>({
      id: "raw.resource.base",
      init: async () => "raw",
    });

    const app = defineResource({
      id: "raw.resource.app",
      register: [baseResource.with({ mode: "base" })],
      overrides: [rawResource.with({ mode: "raw" }) as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / override(...).",
    );
  });

  it("should throw when .overrides receives a non-definition object", async () => {
    const baseTask = defineTask({
      id: "raw.object.base",
      run: async () => "base",
    });

    const app = defineResource({
      id: "raw.object.app",
      register: [baseTask],
      overrides: [{} as any],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      ".overrides([...]) accepts only definitions produced by r.override(...) / override(...).",
    );
  });

  it("should choose precedence when two overrides target the same id", async () => {
    const baseTask = defineTask({
      id: "task.same",
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
      'Override target "task.same" is declared more than once.',
    );
  });
});
