import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
} from "../../define";
import { middleware } from "../../index";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";

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
  });

  // Tasks
  describe("Tasks", () => {
    it("should be able to register an task and execute it", async () => {
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

      await run(app);
    });

    it("should be able to register an task with dependencies and execute it", async () => {
      const dependencyTask = defineTask({
        id: "dependency.task",
        run: async (_, { d1 }) => {
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

      await run(app);
    });

    it("should be able to register an task that emits an event", async () => {
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
        run: eventHandler as any,
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

      await run(app);
    });

    // Lifecycle-specific task events removed

    it("should propagate the error to the parent", async () => {
      const testTask = defineTask({
        id: "test.task",
        run: async () => {
          throw new Error("Task failed");
        },
      });

      let value = false;
      const errorHook = jest.fn();

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

    it("should be able to register an task with middleware and execute it, ensuring the middleware is called in the correct order", async () => {
      const order: string[] = [];

      const testMiddleware1 = middleware.task({
        id: "test.middleware1",
        run: async ({ next }) => {
          order.push("middleware1 before");
          const result = await next();
          order.push("middleware1 after");
          return result;
        },
      });

      const testMiddleware2 = middleware.task({
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

      await run(app);

      expect(order).toEqual([
        "middleware1 before",
        "middleware2 before",
        "task",
        "middleware2 after",
        "middleware1 after",
      ]);
    });

    it("should be able to register an task with middleware that has dependencies and execute it", async () => {
      const dependencyResource = defineResource({
        id: "dependency.resource",
        init: async () => "Dependency Value",
      });

      const testMiddleware = middleware.task({
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

      await run(app);
    });

    it("should throw an error if there's an infinite dependency", async () => {
      const task1: any = defineTask({
        id: "task1",
        dependencies: (): any => ({ task2 }), // Corrected line
        run: async () => "Task 1",
      });

      const task2: any = defineTask({
        id: "task2",
        dependencies: { task1 },
        run: async () => "Task 2",
      });

      // define circular dependency resources
      const resource1: any = defineResource({
        id: "resource1",
        dependencies: (): any => ({
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
        async run(event) {
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

      await run(app);
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should avoid infinite recursion by omitting hook emissions recursively", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const task = defineHook({
        id: "app",
        on: testEvent,
        dependencies: () => ({ testEvent }),
        async run(event, { testEvent }) {
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

      await run(app);
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
        async run(event, { dummyResource }) {
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

      await run(app);
      expect(eventHandler).toHaveBeenCalled();
      expect(matched).toBe(true);
    });

    it("emits hookTriggered and hookCompleted around hook execution (success)", async () => {
      const { globalEvents } = await import("../../globals/globalEvents");

      const testEvent = defineEvent<{ value: number }>({
        id: "hooks.test.event",
      });

      const observed: Array<{ id: string; payload: any }> = [];

      // Listen specifically to the observability events (not global '*')
      const hookTriggeredListener = defineHook({
        id: "tests.hooks.triggered.listener",
        on: globalEvents.hookTriggered,
        async run(event) {
          observed.push({ id: event.id, payload: event.data });
        },
      });

      const hookCompletedListener = defineHook({
        id: "tests.hooks.completed.listener",
        on: globalEvents.hookCompleted,
        async run(event) {
          observed.push({ id: event.id, payload: event.data });
        },
      });

      const handler = jest.fn();
      const appHook = defineHook({
        id: "tests.hooks.app",
        on: testEvent,
        async run(e) {
          handler(e.data.value);
        },
      });

      // Global '*' listener should NOT receive the hookTriggered/hookCompleted
      const globalAnySeen: string[] = [];
      const globalAny = defineHook({
        id: "tests.hooks.globalAny",
        on: "*",
        async run(e) {
          globalAnySeen.push(e.id);
        },
      });

      const app = defineResource({
        id: "hooks.app.success",
        register: [
          testEvent,
          appHook,
          hookTriggeredListener,
          hookCompletedListener,
          globalAny,
        ],
        dependencies: { testEvent },
        async init(_, { testEvent }) {
          await testEvent({ value: 42 });
        },
      });

      await run(app);

      // Ensure our business hook executed
      expect(handler).toHaveBeenCalledWith(42);

      // Ensure we observed both lifecycle events with correct payload for the specific hook
      const appOnly = observed.filter(
        (o) => o.payload.hook?.id === "tests.hooks.app",
      );
      const ids = appOnly.map((o) => o.id);
      expect(ids).toEqual([
        globalEvents.hookTriggered.id,
        globalEvents.hookCompleted.id,
      ]);

      expect(appOnly[0].payload).toEqual({
        hook: expect.objectContaining({ id: "tests.hooks.app" }),
        eventId: testEvent.id,
      });
      expect(appOnly[1].payload).toEqual({
        hook: expect.objectContaining({ id: "tests.hooks.app" }),
        eventId: testEvent.id,
      });

      // Global '*' should not see the observability events
      expect(globalAnySeen).toContain("hooks.test.event");
      expect(globalAnySeen).not.toContain(globalEvents.hookTriggered.id);
      expect(globalAnySeen).not.toContain(globalEvents.hookCompleted.id);
    });

    it("emits hookCompleted with error when hook throws", async () => {
      const { globalEvents } = await import("../../globals/globalEvents");

      const testEvent = defineEvent<{ value: number }>({
        id: "hooks.test.event.error",
      });

      const observed: Array<{ id: string; payload: any }> = [];

      const hookTriggeredListener = defineHook({
        id: "tests.hooks.triggered.listener.error",
        on: globalEvents.hookTriggered,
        async run(event) {
          observed.push({ id: event.id, payload: event.data });
        },
      });

      const hookCompletedListener = defineHook({
        id: "tests.hooks.completed.listener.error",
        on: globalEvents.hookCompleted,
        async run(event) {
          observed.push({ id: event.id, payload: event.data });
        },
      });

      const appHook = defineHook({
        id: "tests.hooks.app.error",
        on: testEvent,
        async run() {
          throw new Error("fail-me");
        },
      });

      const app = defineResource({
        id: "hooks.app.error",
        register: [
          testEvent,
          appHook,
          hookTriggeredListener,
          hookCompletedListener,
        ],
        dependencies: { testEvent },
        async init(_, { testEvent }) {
          await testEvent({ value: 1 });
        },
      });

      await expect(run(app)).rejects.toThrow("fail-me");

      const appOnly = observed.filter(
        (o) => o.payload.hook?.id === "tests.hooks.app.error",
      );
      const ids = appOnly.map((o) => o.id);
      expect(ids).toEqual([
        globalEvents.hookTriggered.id,
        globalEvents.hookCompleted.id,
      ]);

      expect(appOnly[0].payload).toEqual({
        hook: expect.objectContaining({ id: "tests.hooks.app.error" }),
        eventId: testEvent.id,
      });
      expect(appOnly[1].payload.hook.id).toBe("tests.hooks.app.error");
      expect(appOnly[1].payload.eventId).toBe(testEvent.id);
      expect(appOnly[1].payload.error).toBeTruthy();
      expect(appOnly[1].payload.error.message).toContain("fail-me");
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

      await run(app);
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

      await run(app);
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

      await run(app);
      expect(mockFn).toHaveBeenCalled();
    });

    it("should be able to register a resource with configuration and get its value", async () => {
      const testResource = defineResource({
        id: "test.resource",
        init: async (config: { prefix: string }) => `${config.prefix} World!`,
      });

      const t2 = defineResource({
        id: "test.r2",
        async init() {},
      });

      const typeTest = defineResource({
        id: "typeTest",
        register: [
          t2,
          testResource.with({
            prefix: "Hello,",
          }),
        ],
      });

      const app = defineResource({
        id: "app",
        dependencies: { testResource },
        register: [testResource.with({ prefix: "Hello," })],
        async init(_, { testResource }) {
          expect(testResource).toBe("Hello, World!");
        },
      });

      await run(app);
    });

    it("should allow suppression of an error (no longer supported)", async () => {
      const supressMock = jest.fn();
      const erroringResource = defineResource({
        id: "error.resource",
        init: async () => {
          // we do this so it doesn't become a never.
          if (true === true) {
            throw new Error("Init failed");
          }
        },
      });
      const erroringTask = defineTask({
        id: "error.task",
        run: async (event) => {
          if (true === true) {
            throw new Error("Run failed");
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

    await run(app);
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

    await run(app);
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

    await run(app);
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

    await run(app);
    expect(mockFn).toHaveBeenCalled();
  });

  it("should be able to run a resource with a config", async () => {
    const testResource = defineResource({
      id: "test.resource",
      init: async (config: { prefix: string }) => `${config.prefix} World!`,
    });

    const result = await run(testResource.with({ prefix: "Hello," }));
    expect(result.value).toBe("Hello, World!");
  });

  describe("disposal", () => {
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
      expect(disposeFn).toHaveBeenCalledWith(
        "Resource Value",
        {},
        {},
        undefined,
      );
    });

    it("should work with primitive return values", async () => {
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
          return 42; // primitive number
        },
      });

      const result = await run(app);
      expect(result.value + 1).toBe(43); // should work as number
      expect(result.value).toBe(42);
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with object return values", async () => {
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
          return { api: "server", value: 42 };
        },
      });

      const result = await run(app);
      expect(result.value.api).toBe("server");
      expect(result.value.value).toBe(42);
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with null return values", async () => {
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
          return null; // null return value
        },
      });

      const result = await run(app);
      expect(result.value).toBe(null);
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with undefined return values", async () => {
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
          return undefined; // undefined return value
        },
      });

      const result = await run(app);
      expect(result.value).toBe(undefined);
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with boolean return values", async () => {
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
          return true; // boolean return value
        },
      });

      const result = await run(app);
      expect(result.value).toBe(true);
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should forward string methods correctly", async () => {
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
          return "hello world test"; // string return value
        },
      });

      const result = await run(app);
      expect(result.value).toBe("hello world test");
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with symbol return values", async () => {
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
          return Symbol("test"); // symbol return value
        },
      });

      const result = await run(app);
      expect(typeof result.value).toBe("symbol");
      expect(result.value.toString()).toBe("Symbol(test)");
      await result.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });

    it("should work with bigint return values", async () => {
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
          return BigInt(123); // bigint return value
        },
      });

      const result = await run(app);
      expect(typeof result.value).toBe("bigint");
      expect(result.value).toBe(BigInt(123));
      expect(result.value.toString()).toBe("123");
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
        async init(config, deps, context) {
          context.connections.push("main-db");
          // @ts-expect-error - should not allow access to non-existent properties
          context.nonExistentProperty;
          // @ts-expect-error - should not allow writing to non-existent properties
          context.anotherProperty = "test";
          return "connected";
        },
        async dispose(value, config, deps, context) {
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
        async init(config, deps) {
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
        dispose: async function (value, config, deps, context) {
          // When there's no init, dispose still gets called but private context should be available
          // Note: This won't have private context since init wasn't called
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
      const { globalEvents } = await import("../../globals/globalEvents");
      const handler = jest.fn();
      const readyListener = defineHook({
        id: "ready.listener",
        on: globalEvents.ready,
        run: handler as any,
      });
      const app = defineResource({
        id: "app",
        register: [readyListener],
        async init() {
          // nothing
        },
      });
      await run(app);
      expect(handler).toHaveBeenCalled();
    });
  });
});
