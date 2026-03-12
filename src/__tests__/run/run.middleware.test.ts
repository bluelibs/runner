import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { run } from "../../run";
import { createMessageError } from "../../errors";

describe("Middleware", () => {
  it("should be able to register the middleware and execute it", async () => {
    const testMiddleware = defineTaskMiddleware({
      id: "test-middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test-task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [testMiddleware, testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("Middleware: Task executed");
      },
    });

    await run(app);
  });

  it("should work with global middleware", async () => {
    const globalMiddleware = defineTaskMiddleware({
      id: "global-middleware",
      run: async ({ next }) => {
        const result = await next();
        return `global-middleware: ${result}`;
      },
    });

    const testMiddleware = defineTaskMiddleware({
      id: "test-middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test-task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      subtree: {
        tasks: {
          middleware: [globalMiddleware],
        },
      },
      register: [globalMiddleware, testMiddleware, testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("global-middleware: Middleware: Task executed");
      },
    });

    await run(app);
  });

  it("should work with global middleware alongside unrelated local middleware", async () => {
    const createMiddleware = (id: string) =>
      defineTaskMiddleware({
        id: "middleware",
        run: async ({ next }) => {
          const result = await next();
          return `${id}: ${result}`;
        },
      });
    const globalMiddleware = createMiddleware("global-middleware");

    const testMiddleware = defineTaskMiddleware({
      id: "test-middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test-task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      subtree: {
        tasks: {
          middleware: [globalMiddleware],
        },
      },
      register: [globalMiddleware, testMiddleware, testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("global-middleware: Middleware: Task executed");
      },
    });

    await run(app);
  });
  it("should work with a middleware with functional() dependencies", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const testMiddleware = defineTaskMiddleware({
      id: "test-middleware",
      dependencies: () => ({ task }),
      run: async ({ next }, { task }) => {
        const result = await next();
        expect(result).toBe(await task());
        expect(result).toBe("Task executed");
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test-task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const allSolved = jest.fn();
    const app = defineResource({
      id: "app",
      register: [testMiddleware, testTask, task],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("Middleware: Task executed");
        allSolved();
      },
    });

    await run(app);
    expect(allSolved).toHaveBeenCalled();
  });

  it("Should not work with a non-existing middleware", async () => {
    const nonExistentMw = defineTaskMiddleware({
      id: "middlewareId",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test-task",
      middleware: [nonExistentMw],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        await testTask();
      },
    });

    await expect(run(app)).rejects.toThrow(
      `Middleware inside task "test-task" depends on "${nonExistentMw.id}" but it's not registered. Did you forget to register it?`,
    );
  });

  it("Should work with resources", async () => {
    const mw = defineResourceMiddleware({
      id: "middleware",
      run: async ({ resource: _resource, next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });
    const app = defineResource({
      id: "app",
      register: [mw],
      middleware: [mw],
      async init(_, {}) {
        return "App initialized";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Middleware: App initialized");
  });

  it("Should work with global middleware", async () => {
    const mw = defineResourceMiddleware({
      id: "middleware",
      run: async ({ resource: _resource, next }) => {
        const result = await next({});
        return `Middleware: ${result}`;
      },
    });

    const sub = defineResource({
      id: "sub",
      async init(_, {}) {
        return "Sub initialized";
      },
    });

    const app = defineResource({
      id: "app",
      subtree: {
        resources: {
          middleware: [mw],
        },
      },
      register: [mw, sub],
      dependencies: { sub },
      async init(_, { sub }) {
        return sub;
      },
    });

    const result = await run(app);
    expect(String(result.value)).toBe(
      "Middleware: Middleware: Sub initialized",
    );
  });

  it("Should prevent circular dependencies when middleware depends on the same task", async () => {
    const mw: any = defineTaskMiddleware({
      id: "middleware",
      dependencies: (): any => ({ task }),
      run: async (_: any, { task: _task }: any) => {},
    });

    const task: any = defineTask({
      id: "task",
      middleware: [mw],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "sub",
      async init(_, {}) {
        return "Sub initialized";
      },
      register: [mw, task],
    });

    await expect(run(app)).rejects.toThrow(/Circular dependencies detected/);
  });
});

describe("Configurable Middleware (.with)", () => {
  it("should allow using middleware usage in a task and pass config to run", async () => {
    let receivedConfig: any;
    const validate = defineTaskMiddleware({
      id: "validate",
      run: async ({ next }, _deps, config: { schema: string }) => {
        receivedConfig = config;
        return next();
      },
    });
    const usage = validate.with({ schema: "user" });
    const task = defineTask({
      id: "task",
      middleware: [usage],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "app",
      register: [validate, task],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("ok");
        expect(receivedConfig).toEqual({ schema: "user" });
      },
    });
    await run(app);
  });

  it("should allow multiple usages of the same middleware definition with different configs", async () => {
    const calls: (string | undefined)[] = [];
    const validate = defineTaskMiddleware({
      id: "validate",
      run: async ({ next }, _deps, config: { schema: string }) => {
        calls.push(config.schema);
        return next();
      },
    });
    const usage1 = validate.with({ schema: "user" });
    const usage2 = validate.with({ schema: "admin" });
    const task1 = defineTask({
      id: "task1",
      middleware: [usage1],
      run: async () => "ok1",
    });
    const task2 = defineTask({
      id: "task2",
      middleware: [usage2],
      run: async () => "ok2",
    });
    const app = defineResource({
      id: "app",
      register: [validate, task1, task2],
      dependencies: { task1, task2 },
      async init(_, { task1, task2 }) {
        await task1();
        await task2();
        expect(calls).toEqual(["user", "admin"]);
      },
    });
    await run(app);
  });

  it("should work in an integration scenario with global and per-task middleware", async () => {
    const calls: string[] = [];
    const logMw = defineTaskMiddleware({
      id: "log",
      run: async ({ next }) => {
        calls.push("global");
        return next();
      },
    });
    const validate = defineTaskMiddleware({
      id: "validate",
      run: async ({ next }, _deps, config: { schema: string }) => {
        expect(config).toBeDefined();
        calls.push(config!.schema);
        return next();
      },
    });
    const usage = validate.with({ schema: "user" });
    const task = defineTask({
      id: "task",
      middleware: [usage],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "app",
      subtree: {
        tasks: {
          middleware: [logMw],
        },
      },
      register: [logMw, validate, task],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("ok");
        expect(calls).toContain("global");
        expect(calls).toContain("user");
      },
    });
    await run(app);
  });

  it("should enforce type safety for config in .with()", () => {
    const validate = defineTaskMiddleware({
      id: "validate",
      run: async ({ next }, _deps, _config: { schema: string }) => next(),
    });

    // Should error if config type is not correct
    // @ts-expect-error
    validate.with({ schema: 123 });
  });

  it("should modify task outputs independently based on middleware configs", async () => {
    const prefixMiddleware = defineTaskMiddleware({
      id: "prefixer",
      run: async ({ next }, _deps, config: { prefix: string }) => {
        const result = await next();
        return `${config.prefix}: ${result}`;
      },
    });

    const taskA = defineTask({
      id: "taskA",
      middleware: [prefixMiddleware.with({ prefix: "Alpha" })],
      run: async () => "Result",
    });

    const taskB = defineTask({
      id: "taskB",
      middleware: [prefixMiddleware.with({ prefix: "Beta" })],
      run: async () => "Result",
    });

    const app = defineResource({
      id: "app",
      register: [prefixMiddleware, taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, deps) {
        const resultA = await deps.taskA();
        const resultB = await deps.taskB();

        expect(resultA).toBe("Alpha: Result");
        expect(resultB).toBe("Beta: Result");
      },
    });

    await run(app);
  });

  it("should allow configured middleware to be global for tasks", async () => {
    const calls: string[] = [];
    const validate = defineTaskMiddleware<{ schema: string }>({
      id: "validate-global-tasks",
      run: async ({ next }, _deps, config) => {
        calls.push(`global:${config.schema}`);
        return next();
      },
    });

    const task = defineTask({
      id: "task-global",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-global-tasks",
      subtree: {
        tasks: {
          middleware: [validate.with({ schema: "user" })],
        },
      },
      register: [validate, task],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("ok");
      },
    });

    await run(app);
    expect(calls).toContain("global:user");
  });

  it("fails fast when subtree and local task middleware share the same id", async () => {
    const validate = defineTaskMiddleware<{ schema: string }>({
      id: "validate-global-task-conflict",
      run: async ({ next }) => next(),
    });

    const task = defineTask({
      id: "task-global-conflict",
      middleware: [validate.with({ schema: "local" })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-global-task-conflict",
      subtree: {
        tasks: {
          middleware: [validate.with({ schema: "subtree" })],
        },
      },
      register: [validate, task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      /conflicts with a task-local middleware using the same id/i,
    );
  });

  it("should allow configured middleware to be global for resources", async () => {
    const calls: string[] = [];
    const m = defineResourceMiddleware<{ flag: string }>({
      id: "validate-global-resources",
      run: async ({ next, resource }, _deps, config) => {
        if (resource) {
          calls.push(`${String(resource.definition.id)}:${config.flag}`);
        }
        return next();
      },
    });

    const sub = defineResource({
      id: "res-sub",
      async init() {
        return "Sub";
      },
    });

    const app = defineResource({
      id: "res-app",
      subtree: {
        resources: {
          middleware: [m.with({ flag: "X" })],
        },
      },
      register: [m, sub],
      dependencies: { sub },
      async init(_, { sub }) {
        return sub;
      },
    });

    const result = await run(app);
    expect(String(result.value)).toBe("Sub");
    expect(calls).toContain("res-app:X");
    expect(calls).toContain("res-sub:X");
  });

  it("fails fast when subtree and local resource middleware share the same id", async () => {
    const middleware = defineResourceMiddleware<{ flag: string }>({
      id: "validate-global-resource-conflict",
      run: async ({ next }) => next(),
    });

    const child = defineResource({
      id: "res-conflict-child",
      middleware: [middleware.with({ flag: "local" })],
      async init() {
        return "Sub";
      },
    });

    const app = defineResource({
      id: "res-conflict-app",
      subtree: {
        resources: {
          middleware: [middleware.with({ flag: "subtree" })],
        },
      },
      register: [middleware, child],
    });

    await expect(run(app)).rejects.toThrow(
      /conflicts with a resource-local middleware using the same id/i,
    );
  });
});

describe("Middleware behavior (no lifecycle)", () => {
  it("should execute middleware around tasks", async () => {
    const calls: string[] = [];

    const mw = defineTaskMiddleware({
      id: "mw-events",
      run: async ({ next }) => {
        return next();
      },
    });

    const t = defineTask({
      id: "test-task-events",
      middleware: [mw],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-middleware-events",
      register: [mw, t],
      dependencies: { t },
      async init(_, { t }) {
        const result = await t();
        expect(result).toBe("ok");
      },
    });

    await run(app);

    expect(calls).toEqual([]);
  });

  it("should throw middleware errors", async () => {
    const mw = defineTaskMiddleware({
      id: "mw-error",
      run: async () => {
        throw createMessageError("boom");
      },
    });

    const t = defineTask({
      id: "test-task-error",
      middleware: [mw],
      run: async () => "ok",
    });

    let insideInit = false;
    const app = defineResource({
      id: "app-middleware-onError-suppressed",
      register: [mw, t],
      dependencies: { t },
      async init(_, { t }) {
        await expect(t()).rejects.toThrow("boom");
        insideInit = true;
      },
    });

    await run(app);
    expect(insideInit).toBe(true);
  });

  it("global event hooks should not run middleware (no errors thrown)", async () => {
    defineTaskMiddleware({
      id: "mw-error-global-listener",
      run: async () => {
        throw createMessageError("boom-global");
      },
    });

    const evt = defineEvent<{ msg: string }>({
      id: "custom-global-listener-event",
    });

    let called = false;
    const globalListener = defineHook({
      id: "global-listener-task",
      on: "*",
      run: async () => {
        called = true;
      },
    });

    const emitter = defineTask({
      id: "event-emitter-for-global",
      dependencies: { evt },
      run: async (_, { evt }) => {
        await evt({ msg: "hi" });
      },
    });

    const app = defineResource({
      id: "app-middleware-global-listener",
      register: [evt, globalListener, emitter],
      dependencies: { emitter },
      async init(_, { emitter }) {
        await emitter();
      },
    });

    await run(app);
    expect(called).toBe(true);
  });
});
