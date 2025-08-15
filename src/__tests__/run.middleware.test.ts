import {
  defineMiddleware,
  defineTask,
  defineResource,
  defineEvent,
} from "../define";
import { run } from "../run";
import { globalEvents } from "../globals/globalEvents";

describe("Middleware", () => {
  it("should be able to register the middleware and execute it", async () => {
    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test.task",
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
    const globalMiddleware = defineMiddleware({
      id: "global.middleware",
      run: async ({ next }) => {
        const result = await next();
        return `global.middleware: ${result}`;
      },
    });

    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test.task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [globalMiddleware.everywhere(), testMiddleware, testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("global.middleware: Middleware: Task executed");
      },
    });

    await run(app);
  });

  it("should work with global middleware but local one should have priority", async () => {
    const createMiddleware = (id: string) =>
      defineMiddleware({
        id: "middleware",
        run: async ({ next }) => {
          const result = await next();
          return `${id}: ${result}`;
        },
      });
    const globalMiddleware = createMiddleware("global.middleware");

    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test.task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [globalMiddleware.everywhere(), testMiddleware, testTask],
      dependencies: { testTask },
      async init(_, { testTask }) {
        const result = await testTask();
        expect(result).toBe("global.middleware: Middleware: Task executed");
      },
    });

    await run(app);
  });
  it("should work with a middleware with functional() dependencies", async () => {
    const task = defineTask({
      id: "task",
      run: async () => "Task executed",
    });

    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      dependencies: () => ({ task }),
      run: async ({ next }, { task }) => {
        const result = await next();
        expect(result).toBe(await task());
        expect(result).toBe("Task executed");
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test.task",
      middleware: [testMiddleware],
      run: async () => "Task executed",
    });

    let allSolved = jest.fn();
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
    const middlewareDef = defineMiddleware({
      id: "middlewareId",
      run: async ({ next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });

    const testTask = defineTask({
      id: "test.task",
      middleware: [middlewareDef],
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

    // expect it to contain this: Dependency Middleware test.task not found
    await expect(run(app)).rejects.toThrowError(
      /Dependency Middleware middlewareId in Task test.task not found/
    );
  });

  it("Should work with resources", async () => {
    const middleware = defineMiddleware({
      id: "middleware",
      run: async ({ resource, next }) => {
        const result = await next();
        return `Middleware: ${result}`;
      },
    });
    const app = defineResource({
      id: "app",
      register: [middleware],
      middleware: [middleware],
      async init(_, {}) {
        return "App initialized";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("Middleware: App initialized");
  });

  it("Should work with global middleware", async () => {
    const middleware = defineMiddleware({
      id: "middleware",
      run: async ({ resource, next }) => {
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
      register: [middleware.everywhere(), sub],
      dependencies: { sub },
      async init(_, { sub }) {
        return sub;
      },
    });

    const result = await run(app);
    expect(String(result.value)).toBe(
      "Middleware: Middleware: Sub initialized"
    );
  });

  it("Should prevent circular dependencies when middleware depends on the same task", async () => {
    const middleware: any = defineMiddleware({
      id: "middleware",
      dependencies: (): any => ({ task }),
      run: async (_: any, { task }: any) => {
        // example
      },
    });

    const task: any = defineTask({
      id: "task",
      middleware: [middleware],
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "sub",
      async init(_, {}) {
        return "Sub initialized";
      },
      register: [middleware, task],
    });

    expect(run(app)).rejects.toThrowError(/Circular dependencies detected/);
  });
});

describe("Configurable Middleware (.with)", () => {
  it("should allow using middleware usage in a task and pass config to run", async () => {
    let receivedConfig: any;
    const validate = defineMiddleware({
      id: "validate",
      run: async ({ next }, deps, config: { schema: string }) => {
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
    const validate = defineMiddleware({
      id: "validate",
      run: async ({ next }, deps, config: { schema: string }) => {
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
    const log = defineMiddleware({
      id: "log",
      run: async ({ next }) => {
        calls.push("global");
        return next();
      },
    });
    const validate = defineMiddleware({
      id: "validate",
      run: async ({ next }, deps, config: { schema: string }) => {
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
      register: [log.everywhere(), validate, task],
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
    const validate = defineMiddleware({
      id: "validate",
      run: async ({ next }, deps, config: { schema: string }) => next(),
    });

    // Should error if config type is not correct
    // @ts-expect-error
    validate.with({ schema: 123 });
  });

  it("should modify task outputs independently based on middleware configs", async () => {
    const prefixMiddleware = defineMiddleware({
      id: "prefixer",
      run: async ({ next }, deps, config: { prefix: string }) => {
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
    const validate = defineMiddleware<{ schema: string }>({
      id: "validate.global.tasks",
      run: async ({ next }, _deps, config) => {
        calls.push(`global:${config.schema}`);
        return next();
      },
    });

    const task = defineTask({
      id: "task.global",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.global.tasks",
      register: [
        validate
          .with({ schema: "user" })
          .everywhere({ tasks: true, resources: false }),
        task,
      ],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("ok");
      },
    });

    await run(app);
    expect(calls).toContain("global:user");
  });

  it("should allow configured middleware to be global for resources", async () => {
    const calls: string[] = [];
    const m = defineMiddleware<{ flag: string }>({
      id: "validate.global.resources",
      run: async ({ next, resource }, _deps, config) => {
        if (resource) {
          calls.push(`${String(resource.definition.id)}:${config.flag}`);
        }
        return next();
      },
    });

    const sub = defineResource({
      id: "res.sub",
      async init() {
        return "Sub";
      },
    });

    const app = defineResource({
      id: "res.app",
      register: [
        m.with({ flag: "X" }).everywhere({ tasks: false, resources: true }),
        sub,
      ],
      dependencies: { sub },
      async init(_, { sub }) {
        return sub;
      },
    });

    const result = await run(app);
    expect(String(result.value)).toBe("Sub");
    expect(calls).toContain("res.app:X");
    expect(calls).toContain("res.sub:X");
  });
});

describe("Middleware Events Emission", () => {
  it("should emit middleware beforeRun/afterRun events (local and global)", async () => {
    const calls: string[] = [];

    const mw = defineMiddleware({
      id: "mw.events",
      run: async ({ next }) => {
        return next();
      },
    });

    const localBefore = defineTask({
      id: "listener.local.before",
      on: mw.events.beforeRun,
      run: async (event) => {
        const { task } = event.data as any;
        expect(task).toBeDefined();
        expect(task.definition.id).toBe("test.task.events");
        calls.push(`local-before:${String(task.definition.id)}`);
      },
    });

    const localAfter = defineTask({
      id: "listener.local.after",
      on: mw.events.afterRun,
      run: async (event) => {
        const { task } = event.data as any;
        expect(task).toBeDefined();
        expect(task.definition.id).toBe("test.task.events");
        calls.push(`local-after:${String(task.definition.id)}`);
      },
    });

    const globalBefore = defineTask({
      id: "listener.global.before",
      on: globalEvents.middlewares.beforeRun,
      run: async (event) => {
        const { middleware, task } = event.data as any;
        expect(middleware.id).toBe(mw.id);
        expect(task.definition.id).toBe("test.task.events");
        calls.push(`global-before:${String(task.definition.id)}`);
      },
    });

    const globalAfter = defineTask({
      id: "listener.global.after",
      on: globalEvents.middlewares.afterRun,
      run: async (event) => {
        const { middleware, task } = event.data as any;
        expect(middleware.id).toBe(mw.id);
        expect(task.definition.id).toBe("test.task.events");
        calls.push(`global-after:${String(task.definition.id)}`);
      },
    });

    const t = defineTask({
      id: "test.task.events",
      middleware: [mw],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.middleware.events",
      register: [mw, t, localBefore, localAfter, globalBefore, globalAfter],
      dependencies: { t },
      async init(_, { t }) {
        const result = await t();
        expect(result).toBe("ok");
      },
    });

    await run(app);

    expect(calls).toEqual(
      expect.arrayContaining([
        "local-before:test.task.events",
        "local-after:test.task.events",
        "global-before:test.task.events",
        "global-after:test.task.events",
      ])
    );
  });

  it("should emit middleware onError and allow suppression", async () => {
    const localCalls: string[] = [];
    const globalCalls: string[] = [];

    const mw = defineMiddleware({
      id: "mw.error",
      run: async () => {
        throw new Error("boom");
      },
    });

    const localOnError = defineTask({
      id: "listener.local.onError",
      on: mw.events.onError,
      run: async (event) => {
        const { error, suppress, task } = event.data as any;
        expect(error).toBeInstanceOf(Error);
        expect(task.definition.id).toBe("test.task.error");
        localCalls.push("local-onError");
        suppress();
      },
    });

    const globalOnError = defineTask({
      id: "listener.global.onError",
      on: globalEvents.middlewares.onError,
      run: async (event) => {
        const { error, middleware, task } = event.data as any;
        expect(error).toBeInstanceOf(Error);
        expect(middleware.id).toBe(mw.id);
        expect(task.definition.id).toBe("test.task.error");
        globalCalls.push("global-onError");
        // Do not suppress here; suppression already done locally should carry through
      },
    });

    const t = defineTask({
      id: "test.task.error",
      middleware: [mw],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.middleware.onError.suppressed",
      register: [mw, t, localOnError, globalOnError],
      dependencies: { t },
      async init(_, { t }) {
        const result = await t();
        // Since middleware threw but error was suppressed, the chain ends without a value
        expect(result).toBeUndefined();
      },
    });

    await run(app);

    expect(localCalls).toContain("local-onError");
    expect(globalCalls).toContain("global-onError");
  });

  it("should rethrow middleware errors when not suppressed", async () => {
    const mw = defineMiddleware({
      id: "mw.error.nosuppress",
      run: async () => {
        throw new Error("boom");
      },
    });

    const t = defineTask({
      id: "test.task.error.nosuppress",
      middleware: [mw],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.middleware.onError.nosuppress",
      register: [mw, t],
      dependencies: { t },
      async init(_, { t }) {
        await t();
      },
    });

    await expect(run(app)).rejects.toThrowError(/boom/);
  });

  it("should always throw for global event listener tasks (no suppression path)", async () => {
    const mw = defineMiddleware({
      id: "mw.error.global.listener",
      run: async () => {
        throw new Error("boom-global");
      },
    });

    // Handlers for middleware error events – should NOT be called for global listeners
    const localOnErrorCalled: string[] = [];
    const globalOnErrorCalled: string[] = [];

    const localOnError = defineTask({
      id: "listener.local.onError.globalListener",
      on: mw.events.onError,
      run: async () => {
        localOnErrorCalled.push("local");
      },
    });

    const globalOnError = defineTask({
      id: "listener.global.onError.globalListener",
      on: globalEvents.middlewares.onError,
      run: async () => {
        globalOnErrorCalled.push("global");
      },
    });

    const evt = defineEvent<{ msg: string }>({
      id: "custom.global.listener.event",
    });

    const globalListener = defineTask({
      id: "global.listener.task",
      on: "*",
      middleware: [mw],
      run: async () => {
        // should never get here due to middleware throwing
      },
    });

    const emitter = defineTask({
      id: "event.emitter.for.global",
      dependencies: { evt },
      run: async (_, { evt }) => {
        await evt({ msg: "hi" });
      },
    });

    const app = defineResource({
      id: "app.middleware.global.listener",
      register: [mw, localOnError, globalOnError, evt, globalListener, emitter],
      dependencies: { emitter },
      async init(_, { emitter }) {
        await emitter();
      },
    });

    await expect(run(app)).rejects.toThrowError(/boom-global/);

    // Ensure no error events were emitted for middleware when listener is global
    expect(localOnErrorCalled).toHaveLength(0);
    expect(globalOnErrorCalled).toHaveLength(0);
  });
});

describe("Middleware.everywhere()", () => {
  it("should work with { tasks: true, resources: true }", async () => {
    const calls: string[] = [];
    const everywhereMiddleware = defineMiddleware({
      id: "everywhere.middleware",
      run: async ({ next, task, resource }) => {
        if (task) {
          calls.push(`task:${String(task.definition.id)}`);
        }
        if (resource) {
          calls.push(`resource:${String(resource.definition.id)}`);
        }
        return next();
      },
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => "Task executed",
    });

    const testResource = defineResource({
      id: "test.resource",
      async init() {
        return "Resource initialized";
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        everywhereMiddleware.everywhere({ tasks: true, resources: true }),
        testTask,
        testResource,
      ],
      dependencies: { testTask, testResource },
      async init(_, { testTask, testResource }) {
        await testTask();
        expect(testResource).toBe("Resource initialized");
      },
    });

    await run(app);

    expect(calls).toContain("resource:app");
    expect(calls).toContain("resource:test.resource");
    expect(calls).toContain("task:test.task");
  });

  it("should work with { tasks: true, resources: false }", async () => {
    const calls: string[] = [];
    const everywhereMiddleware = defineMiddleware({
      id: "everywhere.middleware",
      run: async ({ next, task, resource }) => {
        if (task) {
          calls.push(`task:${String(task.definition.id)}`);
        }
        if (resource) {
          calls.push(`resource:${String(resource.definition.id)}`);
        }
        return next();
      },
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => "Task executed",
    });

    const testResource = defineResource({
      id: "test.resource",
      async init() {
        return "Resource initialized";
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        everywhereMiddleware.everywhere({ tasks: true, resources: false }),
        testTask,
        testResource,
      ],
      dependencies: { testTask, testResource },
      async init(_, { testTask, testResource }) {
        await testTask();
        expect(testResource).toBe("Resource initialized");
      },
    });

    await run(app);

    expect(calls).not.toContain("resource:app");
    expect(calls).not.toContain("resource:test.resource");
    expect(calls).toContain("task:test.task");
  });

  it("should work with { tasks: false, resources: true }", async () => {
    const calls: string[] = [];
    const everywhereMiddleware = defineMiddleware({
      id: "everywhere.middleware",
      run: async ({ next, task, resource }) => {
        if (task) {
          calls.push(`task:${String(task.definition.id)}`);
        }
        if (resource) {
          calls.push(`resource:${String(resource.definition.id)}`);
        }
        return next();
      },
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => "Task executed",
    });

    const testResource = defineResource({
      id: "test.resource",
      async init() {
        return "Resource initialized";
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        everywhereMiddleware.everywhere({ tasks: false, resources: true }),
        testTask,
        testResource,
      ],
      dependencies: { testTask, testResource },
      async init(_, { testTask, testResource }) {
        await testTask();
        expect(testResource).toBe("Resource initialized");
      },
    });

    await run(app);

    expect(calls).toContain("resource:app");
    expect(calls).toContain("resource:test.resource");
    expect(calls).not.toContain("task:test.task");
  });

  it("should work with filterable task middleware", async () => {
    const calls: string[] = [];
    const everywhereMiddleware = defineMiddleware({
      id: "everywhere.middleware",
      run: async ({ next, task, resource }) => {
        if (task) {
          calls.push(`task:${String(task.definition.id)}`);
        }
        return next();
      },
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => "Task executed",
    });

    const testTask2 = defineTask({
      id: "test.task2",
      run: async () => "Task executed",
    });

    const app = defineResource({
      id: "app",
      register: [
        everywhereMiddleware.everywhere({
          tasks: (task) => task.id === "test.task",
          resources: false,
        }),
        testTask,
        testTask2,
      ],
      dependencies: { testTask, testTask2 },
      async init(_, { testTask, testTask2 }) {
        await testTask();
        await testTask2();
      },
    });

    await run(app);

    expect(calls).toContain("task:test.task");
    expect(calls).not.toContain("task:test.task2");
  });

  it("should ensure that the local middleware has priority over the global middleware in terms of configuration", async () => {
    const calls: string[] = [];
    const middleware = defineMiddleware<{ flag: string }>({
      id: "everywhere.middleware",
      run: async ({ task, resource, next }, deps, config) => {
        if (task) {
          calls.push(`task:${String(task.definition.id)}:${config.flag}`);
        }
        if (resource) {
          calls.push(
            `resource:${String(resource.definition.id)}:${config.flag}`
          );
        }
        return next();
      },
    });

    const resource1 = defineResource({
      id: "resource1",
      middleware: [middleware.with({ flag: "local-resource" })],
      async init() {
        return "Resource1";
      },
    });

    const task1 = defineTask({
      id: "task1",
      middleware: [middleware.with({ flag: "local-task" })],
      run: async () => "Task1",
    });

    const app = defineResource({
      id: "app",
      register: [
        middleware.with({ flag: "global" }).everywhere(),
        resource1,
        task1,
      ],
      dependencies: { resource1, task1 },
      async init(_, { task1 }) {
        await task1();
      },
    });

    const result = await run(app);
    expect(calls).toContain("resource:resource1:local-resource");
    expect(calls).not.toContain("resource:resource1:global");
    expect(calls).toContain("task:task1:local-task");
    expect(calls).not.toContain("task:task1:global");
  });
});
