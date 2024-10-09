import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";
import { globalResources } from "../globalResources";

describe("run", () => {
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
      const testEvent = defineEvent({ id: "test.event" });
      const eventHandler = jest.fn();

      const testTask = defineTask({
        id: "test.task",
        dependencies: { testEvent },
        run: async (_, { testEvent }) => {
          await testEvent({ message: "Event emitted" });
          return "Task completed";
        },
      });

      const handlerTask = defineTask({
        id: "handler.task",
        on: testEvent,
        run: eventHandler,
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

    it("should emit the proper beforeRun, afterRun, onError events and I can listen to them", async () => {
      const beforeRunHandler = jest.fn();
      const afterRunHandler = jest.fn();
      const onErrorHandler = jest.fn();

      const testTask = defineTask({
        id: "test.task",
        run: async () => "Task executed",
      });

      const onBeforeRun = defineTask({
        id: "on.before.run",
        on: testTask.events.beforeRun,
        run: beforeRunHandler,
      });

      const onAfterRun = defineTask({
        id: "on.after.run",
        on: testTask.events.afterRun,
        run: afterRunHandler,
      });

      const onError = defineTask({
        id: "on.error",
        on: testTask.events.onError,
        run: onErrorHandler,
      });

      const app = defineResource({
        id: "app",
        register: [testTask, onBeforeRun, onAfterRun, onError],
        dependencies: { testTask },
        async init(_, { testTask }) {
          await testTask();
          expect(beforeRunHandler).toHaveBeenCalled();
          expect(afterRunHandler).toHaveBeenCalled();
          expect(onErrorHandler).not.toHaveBeenCalled();
        },
      });

      await run(app);
    });

    it("should propagate the error to the parent", async () => {
      const testTask = defineTask({
        id: "test.task",
        run: async () => {
          throw new Error("Task failed");
        },
      });

      let value = false;
      const errorHook = jest.fn();

      const handler = defineTask({
        id: "handler",
        on: testTask.events.onError,
        run: errorHook,
      });

      const app = defineResource({
        id: "app",
        register: [testTask, handler],
        dependencies: { testTask },
        async init(_, { testTask }) {
          await testTask();
        },
      });

      await expect(run(app)).rejects.toThrow("Task failed");
      expect(errorHook).toHaveBeenCalled();
    });

    it("should be able to register an task with middleware and execute it, ensuring the middleware is called in the correct order", async () => {
      const order: string[] = [];

      const testMiddleware1 = defineMiddleware({
        id: "test.middleware1",
        run: async ({ next }) => {
          order.push("middleware1 before");
          const result = await next();
          order.push("middleware1 after");
          return result;
        },
      });

      const testMiddleware2 = defineMiddleware({
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

      const testMiddleware = defineMiddleware({
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
      const task1 = defineTask({
        id: "task1",
        dependencies: () => ({ task2 }), // Corrected line
        run: async () => "Task 1",
      });

      const task2 = defineTask({
        id: "task2",
        dependencies: { task1 },
        run: async () => "Task 2",
      });

      // define circular dependency resources
      const resource1 = defineResource({
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

    it("should be able to listen to an event through the 'on' property", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const task = defineTask({
        id: "app",
        on: testEvent,
        async run(event) {
          eventHandler();
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task],
        dependencies: { task, testEvent },
        async init(_, deps) {
          await deps.testEvent({ message: "Event emitted" });
        },
      });

      await run(app);
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should avoid infinite recursion by omitting task emissions recursively", async () => {
      const testEvent = defineEvent<{ message: string }>({ id: "test.event" });
      const eventHandler = jest.fn();

      const task = defineTask({
        id: "app",
        on: testEvent,
        dependencies: { testEvent },
        async run(event, { testEvent }) {
          eventHandler();
          await testEvent({ message: "Event emitted" });
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task],
        dependencies: { task, testEvent },
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

      const task = defineTask({
        id: "app",
        on: "*",
        async run(event) {
          event.data;
          isReady && eventHandler();
        },
      });

      const app = defineResource({
        id: "app.resource",
        register: [testEvent, task],
        dependencies: { task, testEvent },
        async init(_, deps) {
          isReady = true;
          await deps.testEvent({ message: "Event emitted" });
        },
      });

      await run(app);
      expect(eventHandler).toHaveBeenCalled();
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

    it("should allow suppression of an error", async () => {
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

      const resourceErrorHandler = defineTask({
        id: "resourcehandler",
        on: erroringResource.events.onError,
        run: async (event) => {
          supressMock();
          event.data.suppress();
        },
      });

      const taskErrorHandler = defineTask({
        id: "taskhandler",
        on: erroringTask.events.onError,
        run: async (event) => {
          supressMock();
          event.data.suppress();
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          erroringResource,
          erroringTask,
          resourceErrorHandler,
          taskErrorHandler,
        ],
        dependencies: { erroringResource, erroringTask },
        async init(_, { erroringResource, erroringTask }) {
          expect(erroringResource).toBeUndefined();
          expect(await erroringTask()).toBeUndefined();

          return "ok";
        },
      });

      await expect(run(app)).resolves.toBe("ok");
      expect(supressMock).toHaveBeenCalledTimes(2);
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
        dependencies: { testResource, store: globalResources.store },
        async init(_, { testResource, store }) {
          expect(testResource).toBe("Resource Value");

          return {
            dispose: () => store.dispose(),
          };
        },
      });

      const result = await run(app);
      await result.dispose();
    });
  });
});
