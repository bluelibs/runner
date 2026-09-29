import {
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { r } from "../..";
import { RunnerMode } from "../../types/runner";

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

  it("should resolve dynamic overrides from config and runtime mode", async () => {
    const task = defineTask({
      id: "task-dynamic-mode-override",
      run: async () => "Task executed",
    });

    const overrideTask = r.override(task, async () => "Task overridden");

    const middle = defineResource<{ enabled: boolean }>({
      id: "app-dynamic-mode-override",
      register: [task],
      overrides: (config, mode) =>
        config.enabled && mode === RunnerMode.TEST ? [overrideTask] : [],
    });

    const root = defineResource({
      id: "root-dynamic-mode-override",
      register: [middle.with({ enabled: true })],
      dependencies: { task },
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(root, { mode: RunnerMode.TEST });
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

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
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
});
