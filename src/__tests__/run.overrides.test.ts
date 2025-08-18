import { definitions } from "..";
import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
  defineOverride,
} from "../define";
import { DependencyNotFoundError } from "../errors";
import { run } from "../run";

describe("run.overrides", () => {
  // Tasks
  it("Should work with a simple override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = defineOverride(task, {
      run: async () => "Task overridden",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: {
        task,
      },
      overrides: [overrideTask],
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overridden");
  });

  it("Should work with a deep override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = defineOverride(task, {
      run: async () => "Task overridden",
    });

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

  it("Should work with a deep override with config", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = defineOverride(task, {
      run: async () => "Task overridden",
    });

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

  it("Should work with a override that has an override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = defineOverride(task, {
      run: async () => "Task overridden",
    });

    const resource = defineResource({
      id: "resource",
    });

    const resourceOverride = defineOverride(resource, {
      overrides: [overrideTask],
    });

    const middle = defineResource({
      id: "app",
      register: [task],
      overrides: [resourceOverride],
    });

    const root = defineResource({
      id: "root",
      register: [middle, resource],
      dependencies: { task },
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(root);
    expect(result.value).toBe("Task overridden");
  });

  it("Should work with a override that has an override with config", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const overrideTask = defineOverride(task, {
      run: async () => "Task overridden",
    });

    const resource = defineResource({
      id: "resource",
    });

    const resourceOverride: definitions.IResource<any> = {
      ...resource,
      overrides: [overrideTask],
      async init(config: { test: string }) {
        return "Resource init";
      },
    };

    const middle = defineResource({
      id: "app",
      register: [task],
      overrides: [resourceOverride.with({ test: "ok" })],
    });

    const root = defineResource({
      id: "root",
      register: [middle, resource],
      dependencies: { task },
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(root);
    expect(result.value).toBe("Task overridden");
  });

  it("should work overriding a middleware", async () => {
    const middleware = defineMiddleware({
      id: "middleware",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    const middlewareOverride = defineOverride(middleware, {
      run: async ({ next }) => {
        return `Override: ${await next()}`;
      },
    });

    const task = defineTask({
      id: "task",
      middleware: [middleware],
      run: async () => "Task executed",
    });

    const resource = defineResource({
      id: "resource",
      register: [middleware, task],
      dependencies: { task },
      overrides: [middlewareOverride],
      async init(_, deps) {
        return deps.task();
      },
    });

    const result = await run(resource);
    expect(result.value).toBe("Override: Task executed");
  });

  it("should throw, when you try to override something unregistered", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const override = defineTask({
      id: "task2",
      run: async () => "Task overridden",
    });

    const app = defineResource({
      id: "app",
      dependencies: {
        task,
      },
      overrides: [override],
      async init(_, deps) {
        return await deps.task();
      },
    });

    await expect(run(app)).rejects.toThrowError(
      new DependencyNotFoundError("task2").message,
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

    const app = defineResource({
      id: "app",
      dependencies: {
        r1,
      },
      overrides: [r2.with()],
      async init(_, r1) {
        return r1;
      },
    });

    await expect(run(app)).rejects.toThrowError(
      new DependencyNotFoundError("override2").message,
    );
  });

  it("should have an override priority, the deeper you are, the less priority you have in the override", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const override = defineTask({
      id: "task2",
      run: async () => "Task overridden",
    });

    const override2 = defineTask({
      id: "task",
      run: async () => "Task super-overridden",
    });

    const middle = defineResource({
      id: "app",
      register: [task],
      overrides: [override],
    });

    const app = defineResource({
      id: "app",
      dependencies: {
        task,
      },
      register: [middle],
      overrides: [override2],
      async init(_, deps) {
        return await deps.task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task super-overridden");
  });

  it("should override if I have a previously registered normal resource with a resource with config", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });
    const r2 = defineResource({
      id: "override",
      init: async () => "Task overriden.",
    });

    const app = defineResource({
      id: "app",
      dependencies: {
        r1,
      },
      register: [r1],
      overrides: [r2.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should override if I have a previously registered normal resource with a resource with config", async () => {
    const r1 = defineResource({
      id: "override",
      init: async () => "Task executed",
    });
    const r2 = defineResource({
      id: "override",
      init: async () => "Task overriden.",
    });

    const app = defineResource({
      id: "app",
      dependencies: {
        r1,
      },
      register: [r1.with()],
      overrides: [r2.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
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

    const r2 = defineResource({
      id: "override",
      init: async () => "Task overriden.",
    });

    const app = defineResource({
      id: "app",
      dependencies: {
        r1,
      },
      register: [middle2],
      overrides: [r2.with()],
      async init(_, deps) {
        return deps.r1;
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Task overriden.");
  });

  it("should choose precedence when two overrides target the same id", async () => {
    const baseTask = defineTask({
      id: "task.same",
      run: async () => "Original",
    });

    const middleOverride = defineOverride(baseTask, {
      run: async () => "Middle",
    });

    const rootOverride = defineOverride(baseTask, {
      run: async () => "Root",
    });

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

    const result = await run(app);
    // Since root is visited after middle, its override takes precedence.
    expect(result.value).toBe("Root");
  });
});
