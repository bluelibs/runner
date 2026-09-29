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
});
