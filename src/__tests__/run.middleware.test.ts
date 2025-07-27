import { defineMiddleware, defineTask, defineResource } from "../define";
import { run } from "../run";

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
      register: [globalMiddleware.global(), testMiddleware, testTask],
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
      register: [globalMiddleware.global(), testMiddleware, testTask],
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
      run: async ({ resourceDefinition, config: resourceConfig, next }) => {
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
    expect(String(result)).toBe("Middleware: App initialized");
  });

  it("Should work with global middleware", async () => {
    const middleware = defineMiddleware({
      id: "middleware",
      run: async ({ resourceDefinition, config: resourceConfig, next }) => {
        const result = await next();
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
      register: [middleware.global(), sub],
      dependencies: { sub },
      async init(_, { sub }) {
        return sub;
      },
    });

    const result = await run(app);
    expect(String(result)).toBe("Middleware: Middleware: Sub initialized");
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
