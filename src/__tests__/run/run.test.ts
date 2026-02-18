import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { run } from "../../run";
import { globalEvents } from "../../globals/globalEvents";
import { createMessageError } from "../../errors";

describe("run", () => {
  // Initial run
  it("should be able to instantiate with or without config", async () => {
    const testResource = defineResource({
      id: "test.resource",
      init: async () => "Resource Value",
    });

    type TestResource2Config = {
      name: string;
    };
    const testResource2 = defineResource({
      id: "test.resource2",
      init: async (_: TestResource2Config) => "Resource Value",
    });

    const run1 = await run(testResource);
    const run2 = await run(testResource2.with({ name: "test" }));

    expect(run1.value).toBe("Resource Value");
    expect(run2.value).toBe("Resource Value");

    await run1.dispose();
    await run2.dispose();
  });

  // Tasks
  describe("Tasks", () => {
    it("should be able to register a task and execute it", async () => {
      const testTask = defineTask({
        id: "test.task",
        run: async () => "Hello, World!",
      });

      const app = defineResource({
        id: "app",
        dependencies: { testTask },
        register: [testTask],
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe("Hello, World!");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should be able to register a task with dependencies and execute it", async () => {
      const dependencyTask = defineTask({
        id: "dependency.task",
        run: async (_) => {
          return "Dependency";
        },
      });

      const testTask = defineTask({
        id: "test.task",
        dependencies: { dependencyTask },
        run: async (_, deps) => {
          const dep = await deps.dependencyTask();
          return `Hello, ${dep}!`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [dependencyTask, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe("Hello, Dependency!");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should be able to register a task that emits an event", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const testTask = defineTask({
        id: "test.task",
        dependencies: { testEvent },
        run: async (_, { testEvent }) => {
          await testEvent({ message: "Event emitted" });
          return "Task completed";
        },
      });

      const handlerTask = defineHook({
        id: "handler.task",
        on: testEvent,
        run: async (event) => eventHandler(event),
      });

      const app = defineResource({
        id: "app",
        register: [testEvent, testTask, handlerTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          await testTask();
          expect(eventHandler).toHaveBeenCalled();
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should compute dependencies() for events for a task", async () => {
      const testEvent = defineEvent<{ message: string }>({
        id: "test.event.fn",
      });
      const eventHandler = jest.fn();

      const emitterTask = defineTask({
        id: "emitter.task",
        dependencies: () => ({ testEvent }),
        async run(_, { testEvent }) {
          await testEvent({ message: "Emitted" });
          return "done";
        },
      });

      const hookListener = defineHook({
        id: "listener.task",
        on: testEvent,
        run: async (event) => eventHandler(event),
      });

      const app = defineResource({
        id: "app",
        register: [testEvent, hookListener, emitterTask],
        dependencies: { emitterTask },
        async init(_, { emitterTask }) {
          await emitterTask();
          expect(eventHandler).toHaveBeenCalled();
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    // Lifecycle-specific task events removed

    it("should propagate the error to the parent", async () => {
      const testTask = defineTask({
        id: "test.task",
        run: async () => {
          throw createMessageError("Task failed");
        },
      });

      const app = defineResource({
        id: "app",
        register: [testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          await testTask();
        },
      });

      await expect(run(app)).rejects.toThrow("Task failed");
    });

    it("should be able to register a task with middleware and execute it, ensuring the middleware is called in the correct order", async () => {
      const order: string[] = [];

      const testMiddleware1 = defineTaskMiddleware({
        id: "test.middleware1",
        run: async ({ next }) => {
          order.push("middleware1 before");
          const result = await next();
          order.push("middleware1 after");
          return result;
        },
      });

      const testMiddleware2 = defineTaskMiddleware({
        id: "test.middleware2",
        run: async ({ next }) => {
          order.push("middleware2 before");
          const result = await next();
          order.push("middleware2 after");
          return result;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [testMiddleware1, testMiddleware2],
        run: async () => {
          order.push("task");
          return "Task executed";
        },
      });

      const app = defineResource({
        id: "app",
        register: [testMiddleware1, testMiddleware2, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          await testTask();
        },
      });

      const result = await run(app);
      await result.dispose();

      expect(order).toEqual([
        "middleware1 before",
        "middleware2 before",
        "task",
        "middleware2 after",
        "middleware1 after",
      ]);
    });

    it("should be able to register a task with middleware that has dependencies and execute it", async () => {
      const dependencyResource = defineResource({
        id: "dependency.resource",
        init: async () => "Dependency Value",
      });

      const testMiddleware = defineTaskMiddleware({
        id: "test.middleware",
        dependencies: { dependencyResource },
        run: async ({ next }, { dependencyResource }) => {
          const result = await next();
          return `${result} - ${dependencyResource}`;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [testMiddleware],
        run: async () => "Task executed",
      });

      const app = defineResource({
        id: "app",
        dependencies: { testTask },
        register: [dependencyResource, testMiddleware, testTask],
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe("Task executed - Dependency Value");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should throw an error if there's an infinite dependency", async () => {
      const task1: any = defineTask({
        id: "task1",
        dependencies: () => ({ task2 }),
        run: async () => "Task 1",
      });

      const task2 = defineTask({
        id: "task2",
        dependencies: { task1 },
        run: async () => "Task 2",
      });

      // define circular dependency resources
      const resource1: any = defineResource({
        id: "resource1",
        dependencies: () => ({
          resource2,
        }),
        init: async () => "Resource 1",
      });

      const resource2 = defineResource({
        id: "resource2",
        dependencies: { resource1 },
        init: async () => "Resource 2",
      });

      task1.dependencies.task2 = task2;

      const app = defineResource({
        id: "app",
        register: [resource1, resource2],
      });

      await expect(run(app)).rejects.toThrow(/Circular dependencies detected/);
    });

    it("should be able to listen to an event through a hook", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const task = defineHook({
        id: "app",
        on: testEvent,
        async run(_event) {
          eventHandler();
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task],
        dependencies: { testEvent },
        async init(_, deps) {
          await deps.testEvent({ message: "Event emitted" });
        },
      });

      const result = await run(app);
      await result.dispose();
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should avoid infinite recursion by omitting hook emissions recursively", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const task = defineHook({
        id: "app",
        on: testEvent,
        dependencies: () => ({ testEvent }),
        async run(_event, { testEvent }) {
          eventHandler();
          await testEvent({ message: "Event emitted" });
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task],
        dependencies: { testEvent },
        async init(_, deps) {
          await deps.testEvent({ message: "Event emitted" });
        },
      });

      const result = await run(app);
      await result.dispose();
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should be able to listen to global events", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();
      let isReady = false;
      let matched = false;

      const dummyResource = defineResource({
        id: "dummy",
        init: async () => "dummy",
      });
      const task = defineHook({
        id: "app.hook",
        on: "*",
        dependencies: { dummyResource },
        async run(_event, { dummyResource }) {
          if (dummyResource === "dummy") {
            matched = true;
          }
          isReady && eventHandler();
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task, dummyResource],
        dependencies: { testEvent },
        async init(_, deps) {
          isReady = true;
          await deps.testEvent({ message: "Event emitted" });
        },
      });

      const result = await run(app);
      await result.dispose();
      expect(eventHandler).toHaveBeenCalled();
      expect(matched).toBe(true);
    });
  });

  // Resources
  describe("Resources", () => {
    it("should be able to register a resource and get its value", async () => {
      const testResource = defineResource({
        id: "test.resource",
        init: async () => "Resource Value",
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
        dependencies: { testResource },
        async init(_, { testResource }) {
          expect(testResource).toBe("Resource Value");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should be able to register a resource with dependencies and get its value", async () => {
      const dependencyResource = defineResource({
        id: "dependency.resource",
        init: async () => "Dependency",
      });

      const testResource = defineResource({
        id: "test.resource",
        dependencies: { dependencyResource },
        init: async (_, { dependencyResource }) =>
          `Hello, ${dependencyResource}!`,
      });

      const app = defineResource({
        id: "app",
        register: [dependencyResource, testResource],
        dependencies: { testResource },
        async init(_, { testResource }) {
          expect(testResource).toBe("Hello, Dependency!");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should allow to register a resource without an init task", async () => {
      const mockFn = jest.fn();
      const testResourceWithInit = defineResource({
        id: "test.resource.with.init",
        init: mockFn,
      });

      const testResource = defineResource({
        id: "test.resource",
        register: [testResourceWithInit],
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
      });

      const result = await run(app);
      await result.dispose();
      expect(mockFn).toHaveBeenCalled();
    });

    it("should be able to register a resource with configuration and get its value", async () => {
      const testResource = defineResource({
        id: "test.resource",
        init: async (config: { prefix: string }) => `${config.prefix} World!`,
      });

      defineResource({
        id: "test.r2",
        async init() {},
      });

      const app = defineResource({
        id: "app",
        dependencies: { testResource },
        register: [testResource.with({ prefix: "Hello," })],
        async init(_, { testResource }) {
          expect(testResource).toBe("Hello, World!");
        },
      });

      const result = await run(app);
      await result.dispose();
    });

    it("should allow suppression of an error (no longer supported)", async () => {
      const supressMock = jest.fn();
      const erroringResource = defineResource({
        id: "error.resource",
        init: async () => {
          // we do this so it doesn't become a never.
          if (true === true) {
            throw createMessageError("Init failed");
          }
        },
      });
      const erroringTask = defineTask({
        id: "error.task",
        run: async (_event) => {
          if (true === true) {
            throw createMessageError("Run failed");
          }
        },
      });

      const app = defineResource({
        id: "app",
        register: [erroringResource, erroringTask],
        dependencies: { erroringResource, erroringTask },
        async init(_, { erroringTask }) {
          await expect(erroringTask()).rejects.toThrow("Run failed");
        },
      });

      await expect(run(app)).rejects.toThrow("Init failed");
      expect(supressMock).toHaveBeenCalledTimes(0);
    });
  });

  it("should be able to register as a function", async () => {
    const mockFn = jest.fn();
    const testResource = defineResource({
      id: "test.resource",
      init: mockFn,
    });

    const app = defineResource({
      id: "app",
      register: () => [testResource],
    });

    const result = await run(app);
    await result.dispose();
    expect(mockFn).toHaveBeenCalled();
  });

  it("should be able to register a dependency via function", async () => {
    const mockFn = jest.fn();
    const testResource = defineResource({
      id: "test.resource",
      init: async () => {
        mockFn();
        return "XXX";
      },
    });

    const app = defineResource({
      id: "app",
      dependencies: () => ({ testResource }),
      register: () => [testResource],
      async init(_, { testResource }) {
        expect(testResource).toBe("XXX"); // that's what the mock function returns.
      },
    });

    const result = await run(app);
    await result.dispose();
    expect(mockFn).toHaveBeenCalled();
  });

  it("resources - should be able to register a dependency via function", async () => {
    const mockFn = jest.fn();
    const testResource = defineResource({
      id: "test.resource",
      init: async () => {
        mockFn();
        return "XXX";
      },
    });

    const middle = defineResource({
      id: "middle",
      dependencies: () => ({ testResource }),
      register: () => [testResource],
      async init(_, { testResource }) {
        expect(testResource).toBe("XXX");
        return "middle";
      },
    });

    const app = defineResource({
      id: "app",
      dependencies: () => ({ middle }),
      register: () => [middle],
      async init(_, { middle }) {
        expect(middle).toBe("middle");
      },
    });

    const result = await run(app);
    await result.dispose();
    expect(mockFn).toHaveBeenCalled();
  });

  it("tasks - should be able to register a dependency via function", async () => {
    const mockFn = jest.fn();
    const testTask = defineTask({
      id: "test.task",
      run: async () => {
        mockFn();
        return "XXX";
      },
    });

    const middle = defineTask({
      id: "middle",
      dependencies: () => ({ testTask }),
      async run(_, { testTask }) {
        expect(await testTask()).toBe("XXX");
        return "middle";
      },
    });

    const app = defineResource({
      id: "app",
      dependencies: () => ({ middle }),
      register: () => [middle, testTask],
      async init(_, { middle }) {
        expect(await middle()).toBe("middle");
      },
    });

    const result = await run(app);
    await result.dispose();
    expect(mockFn).toHaveBeenCalled();
  });

  it("should be able to run a resource with a config", async () => {
    const testResource = defineResource({
      id: "test.resource",
      init: async (config: { prefix: string }) => `${config.prefix} World!`,
    });

    const result = await run(testResource.with({ prefix: "Hello," }));
    expect(result.value).toBe("Hello, World!");
    await result.dispose();
  });

  describe("disposal", () => {
    it("disposes dependents before dependencies", async () => {
      const callOrder: string[] = [];

      const dependency = defineResource({
        id: "test.resource.dispose.dep",
        init: async () => "dep",
        dispose: async () => {
          callOrder.push("dep");
        },
      });

      const dependent = defineResource({
        id: "test.resource.dispose.dependent",
        dependencies: { dependency },
        init: async (_config, { dependency }) => `dependent:${dependency}`,
        dispose: async () => {
          callOrder.push("dependent");
        },
      });

      const app = defineResource({
        id: "test.resource.dispose.app",
        // Register dependency first to ensure registration order does not
        // accidentally match the desired disposal order.
        register: [dependency, dependent],
        dependencies: { dependent },
        init: async (_config, { dependent }) => dependent,
      });

      const result = await run(app);
      await result.dispose();

      expect(callOrder).toEqual(["dependent", "dep"]);
    });

    it("should be able to dispose of a resource", async () => {
      const disposeFn = jest.fn();
      const testResource = defineResource({
        id: "test.resource",
        dispose: disposeFn,
        init: async () => "Resource Value",
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
        dependencies: { testResource },
        async init(_, { testResource }) {
          expect(testResource).toBe("Resource Value");
          return testResource;
        },
      });

      const result = await run(app);
      expect(result.value).toBe("Resource Value");
      await result.dispose();
      expect(disposeFn).toHaveBeenCalledWith("Resource Value", {}, {}, {});
    });

    it.each([
      { name: "primitive number", value: 42, expected: 42 },
      {
        name: "object",
        value: { api: "server", value: 42 },
        expected: { api: "server", value: 42 },
      },
      { name: "null", value: null, expected: null },
      { name: "undefined", value: undefined, expected: undefined },
      { name: "boolean", value: true, expected: true },
      {
        name: "string",
        value: "hello world test",
        expected: "hello world test",
      },
      {
        name: "symbol",
        value: Symbol("test"),
        expected: (v: any) => expect(v.toString()).toBe("Symbol(test)"),
      },
      { name: "bigint", value: BigInt(123), expected: BigInt(123) },
    ])("should work with $name return values", async ({ value, expected }) => {
      const disposeFn = jest.fn();
      const testResource = defineResource({
        id: "test.resource",
        dispose: disposeFn,
        init: async () => "Resource Value",
      });

      const app = defineResource({
        id: "app",
        register: [testResource],
        dependencies: { testResource },
        async init(_config, { testResource: _ }) {
          return value;
        },
      });

      const result = await run(app);
      if (typeof expected === "function") {
        expected(result.value);
      } else {
        expect(result.value).toEqual(expected);
      }
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });
  });

  describe("private context resources", () => {
    it("should share private context between init and dispose", async () => {
      const disposeFn = jest.fn();
      const dbResource = defineResource({
        id: "db.resource",
        context: () => ({ connections: [] as string[] }),
        async init(_config, _deps, context) {
          context.connections.push("main-db");
          // @ts-expect-error - should not allow access to non-existent properties
          context.nonExistentProperty;
          // @ts-expect-error - should not allow writing to non-existent properties
          context.anotherProperty = "test";
          return "connected";
        },
        async dispose(_value, _config, _deps, context) {
          expect(context.connections).toEqual(["main-db"]);
          disposeFn();

          context.connections.length = 0; // cleanup
          // @ts-expect-error - should not allow access to non-existent properties in dispose
          context.undefinedProperty;
        },
      });

      const app = defineResource({
        id: "app",
        register: [dbResource],
        dependencies: { dbResource },
        async init(_, { dbResource }) {
          return dbResource;
        },
      });

      const result = await run(app);
      await result.dispose();

      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work without context", async () => {
      const simpleResource = defineResource({
        id: "simple.resource",
        async init(_config, _deps) {
          return "simple value";
        },
      });

      const app = defineResource({
        id: "app",
        register: [simpleResource],
        dependencies: { simpleResource },
        async init(_, { simpleResource }) {
          return simpleResource;
        },
      });

      const result = await run(app);
      expect(result.value).toBe("simple value");
      await result.dispose();
    });

    it("should work with private context and dispose only", async () => {
      const disposeFn = jest.fn();

      // Test dispose function with private context but no init
      const contextOnlyResource = defineResource({
        id: "context.only",
        context: () => ({ cleanupTasks: ["task1", "task2"] }),
        // This resource only has dispose, testing the private context in dispose scenario
        dispose: async function (_value, _config, _deps, _context) {
          // When there's no init, dispose still gets called but private context should be available
          disposeFn();
        },
      });

      const app = defineResource({
        id: "app",
        register: [contextOnlyResource],
        dependencies: { contextOnlyResource },
        async init(_, { contextOnlyResource }) {
          // Resource without init should be undefined
          expect(contextOnlyResource).toBeUndefined();
          return "app started";
        },
      });

      const result = await run(app);
      expect(result.value).toBe("app started");
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should handle resources without init method and proper disposal types", async () => {
      const disposeFn = jest.fn();

      // Resource without init - just registers other resources
      const registrationOnlyResource = defineResource({
        id: "registration.only",
        // No init method
        dispose: disposeFn,
        register: [],
      });

      const app = defineResource({
        id: "app",
        register: [registrationOnlyResource],
        dependencies: { registrationOnlyResource },
        async init(_, { registrationOnlyResource }) {
          // registrationOnlyResource should be undefined since no init
          expect(registrationOnlyResource).toBeUndefined();
          return 42;
        },
      });

      const result = await run(app);
      expect(result.value).toBe(42);
      await result.dispose();

      // dispose should be called with undefined value since no init
      expect(disposeFn).toHaveBeenCalledWith(undefined, {}, {}, {});
    });
  });

  describe("system ready event", () => {
    it("should allow listeners to hook into globalEvents.ready and be called when the system is ready", async () => {
      const handler = jest.fn();
      const readyListener = defineHook({
        id: "ready.listener",
        on: globalEvents.ready,
        run: async (event) => handler(event),
      });
      const app = defineResource({
        id: "app",
        register: [readyListener],
        async init() {
          // nothing
        },
      });
      const result = await run(app);
      await result.dispose();
      expect(handler).toHaveBeenCalled();
    });
  });

  it("should ensure that register.init() is called more than once", async () => {
    const init = jest.fn();
    const frequentlyUsedResource = defineResource({
      id: "frequently.used.resource",
      init,
    });

    const middleware = defineResourceMiddleware({
      id: "middleware",
      everywhere: true,
      run: async ({ next }) => {
        return next();
      },
    });

    const r1 = defineResource({
      id: "r1",
      dependencies: { frequentlyUsedResource },
      async init(_, { frequentlyUsedResource }) {
        return frequentlyUsedResource;
      },
    });

    const r2 = defineResource({
      id: "r2",
      register: [r1],
      dependencies: { r1 },
      async init(_, { r1 }) {
        return r1;
      },
    });

    const app = defineResource({
      id: "app",
      register: [r2, frequentlyUsedResource, middleware],
      dependencies: { r2 },
      async init(_, { r2 }) {
        return r2;
      },
    });

    const result = await run(app);
    await result.dispose();
    expect(init).toHaveBeenCalledTimes(1);
  });
});
