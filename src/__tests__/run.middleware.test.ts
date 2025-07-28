import { defineMiddleware, defineTask, defineResource } from "../define";
import { run } from "../run";
import { retryMiddleware } from "../globals/middleware/retry.middleware";

// Middleware
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
    const middleware = defineMiddleware({
      id: "middleware",
      dependencies: () => ({ task }),
      run: async (_, { task }) => {
        // example
      },
    });

    const task = defineTask({
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
    let receivedConfig;
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
});
