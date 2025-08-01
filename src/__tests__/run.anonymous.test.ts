import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";

describe("Anonymous Components", () => {
  describe("Anonymous Tasks", () => {
    it("should create and execute an anonymous task", async () => {
      const anonymousTask = defineTask({
        run: async () => "Anonymous task executed",
      });

      // ID should be a symbol
      expect(typeof anonymousTask.id).toBe("symbol");
      expect(anonymousTask.id.toString()).toContain("anonymous.test.task");

      const app = defineResource({
        id: "app",
        register: [anonymousTask],
        dependencies: { anonymousTask },
        async init(_, { anonymousTask }) {
          const result = await anonymousTask();
          expect(result).toBe("Anonymous task executed");
        },
      });

      await run(app);
    });

    it("should create anonymous task with dependencies", async () => {
      const anonymousResource = defineResource({
        init: async () => "Anonymous dependency",
      });

      const anonymousTask = defineTask({
        dependencies: { anonymousResource },
        run: async (_, { anonymousResource }) => {
          return `Hello, ${anonymousResource}!`;
        },
      });

      expect(typeof anonymousTask.id).toBe("symbol");
      expect(typeof anonymousResource.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousResource, anonymousTask],
        dependencies: { anonymousTask },
        async init(_, { anonymousTask }) {
          const result = await anonymousTask();
          expect(result).toBe("Hello, Anonymous dependency!");
        },
      });

      await run(app);
    });

    it("should emit anonymous task events", async () => {
      const eventHandler = jest.fn();

      const anonymousTask = defineTask({
        run: async () => "Task executed",
      });

      const eventListener = defineTask({
        id: "listener",
        on: anonymousTask.events.afterRun,
        run: eventHandler,
      });

      expect(typeof anonymousTask.events.afterRun.id).toBe("symbol");
      expect(anonymousTask.events.afterRun.id.toString()).toContain(
        "anonymous-task.events.afterRun"
      );

      const app = defineResource({
        id: "app",
        register: [anonymousTask, eventListener],
        dependencies: { anonymousTask },
        async init(_, { anonymousTask }) {
          await anonymousTask();
          expect(eventHandler).toHaveBeenCalled();
        },
      });

      await run(app);
    });

    it("should handle anonymous task with middleware", async () => {
      const order: string[] = [];

      const anonymousMiddleware = defineMiddleware({
        run: async ({ next }) => {
          order.push("middleware before");
          const result = await next();
          order.push("middleware after");
          return result;
        },
      });

      const anonymousTask = defineTask({
        middleware: [anonymousMiddleware],
        run: async () => {
          order.push("task");
          return "Task with middleware";
        },
      });

      expect(typeof anonymousTask.id).toBe("symbol");
      expect(typeof anonymousMiddleware.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousMiddleware, anonymousTask],
        dependencies: { anonymousTask },
        async init(_, { anonymousTask }) {
          const result = await anonymousTask();
          expect(result).toBe("Task with middleware");
        },
      });

      await run(app);

      expect(order).toEqual(["middleware before", "task", "middleware after"]);
    });

    it("should listen to anonymous events", async () => {
      const eventHandler = jest.fn();

      const anonymousEvent = defineEvent<{ message: string }>({});

      const eventEmitter = defineTask({
        dependencies: { anonymousEvent },
        run: async (_, { anonymousEvent }) => {
          await anonymousEvent({ message: "Anonymous event!" });
          return "Event emitted";
        },
      });

      const eventListener = defineTask({
        on: anonymousEvent,
        run: eventHandler,
      });

      expect(typeof anonymousEvent.id).toBe("symbol");
      expect(anonymousEvent.id.toString()).toContain("anonymous.test.event");

      const app = defineResource({
        id: "app",
        register: [anonymousEvent, eventEmitter, eventListener],
        dependencies: { eventEmitter },
        async init(_, { eventEmitter }) {
          await eventEmitter();
          expect(eventHandler).toHaveBeenCalled();
        },
      });

      await run(app);
    });
  });

  describe("Anonymous Resources", () => {
    it("should create and initialize an anonymous resource", async () => {
      const anonymousResource = defineResource({
        init: async () => "Anonymous resource value",
      });

      expect(typeof anonymousResource.id).toBe("symbol");
      expect(anonymousResource.id.toString()).toContain(
        "anonymous.test.resource"
      );

      const app = defineResource({
        id: "app",
        register: [anonymousResource],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBe("Anonymous resource value");
        },
      });

      await run(app);
    });

    it("should create anonymous resource with dependencies", async () => {
      const dependencyResource = defineResource({
        init: async () => "Dependency value",
      });

      const anonymousResource = defineResource({
        dependencies: { dependencyResource },
        init: async (_, { dependencyResource }) => {
          return `Using ${dependencyResource}`;
        },
      });

      expect(typeof anonymousResource.id).toBe("symbol");
      expect(typeof dependencyResource.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [dependencyResource, anonymousResource],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBe("Using Dependency value");
        },
      });

      await run(app);
    });

    it("should create anonymous resource with configuration", async () => {
      const anonymousResource = defineResource({
        init: async (config: { prefix: string }) =>
          `${config.prefix} configured!`,
      });

      expect(typeof anonymousResource.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousResource.with({ prefix: "Anonymous" })],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBe("Anonymous configured!");
        },
      });

      await run(app);
    });

    it("should emit anonymous resource events", async () => {
      const eventHandler = jest.fn();

      const anonymousResource = defineResource({
        init: async () => "Resource initialized",
      });

      const eventListener = defineTask({
        id: "listener",
        on: anonymousResource.events.afterInit,
        run: eventHandler,
      });

      expect(typeof anonymousResource.events.afterInit.id).toBe("symbol");
      expect(anonymousResource.events.afterInit.id.toString()).toContain(
        "anonymous-resource.events.afterInit"
      );

      const app = defineResource({
        id: "app",
        register: [anonymousResource, eventListener],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBe("Resource initialized");
          expect(eventHandler).toHaveBeenCalled();
        },
      });

      await run(app);
    });

    it("should dispose anonymous resource properly", async () => {
      const disposeFn = jest.fn();

      const anonymousResource = defineResource({
        init: async () => "Resource value",
        dispose: disposeFn,
      });

      const app = defineResource({
        id: "app",
        register: [anonymousResource],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBe("Resource value");
          return anonymousResource;
        },
      });

      const result = await run(app);
      await result.dispose();

      expect(disposeFn).toHaveBeenCalledWith(
        "Resource value",
        {},
        {},
        undefined
      );
    });

    it("should work with anonymous resource without init method", async () => {
      const nestedResource = defineResource({
        init: async () => "Nested value",
      });

      const anonymousResource = defineResource({
        register: [nestedResource],
      });

      expect(typeof anonymousResource.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousResource],
        dependencies: { anonymousResource },
        async init(_, { anonymousResource }) {
          expect(anonymousResource).toBeUndefined();
        },
      });

      await run(app);
    });
  });

  describe("Anonymous Events", () => {
    it("should create and emit anonymous events", async () => {
      const eventHandler = jest.fn();

      const anonymousEvent = defineEvent<{ data: string }>({});

      const emitter = defineTask({
        dependencies: { anonymousEvent },
        run: async (_, { anonymousEvent }) => {
          await anonymousEvent({ data: "Anonymous event data" });
        },
      });

      const listener = defineTask({
        on: anonymousEvent,
        run: eventHandler,
      });

      expect(typeof anonymousEvent.id).toBe("symbol");
      expect(anonymousEvent.id.toString()).toContain("anonymous.test.event");

      const app = defineResource({
        id: "app",
        register: [anonymousEvent, emitter, listener],
        dependencies: { emitter },
        async init(_, { emitter }) {
          await emitter();
          expect(eventHandler).toHaveBeenCalledWith(
            expect.objectContaining({
              data: { data: "Anonymous event data" },
            }),
            expect.any(Object)
          );
        },
      });

      await run(app);
    });

    it("should handle multiple anonymous events", async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const anonymousEvent1 = defineEvent<{ type: string }>({});
      const anonymousEvent2 = defineEvent<{ value: number }>({});

      const emitter = defineTask({
        dependencies: { anonymousEvent1, anonymousEvent2 },
        run: async (_, { anonymousEvent1, anonymousEvent2 }) => {
          await anonymousEvent1({ type: "first" });
          await anonymousEvent2({ value: 42 });
        },
      });

      const listener1 = defineTask({
        on: anonymousEvent1,
        run: handler1,
      });

      const listener2 = defineTask({
        on: anonymousEvent2,
        run: handler2,
      });

      expect(typeof anonymousEvent1.id).toBe("symbol");
      expect(typeof anonymousEvent2.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [
          anonymousEvent1,
          anonymousEvent2,
          emitter,
          listener1,
          listener2,
        ],
        dependencies: { emitter },
        async init(_, { emitter }) {
          await emitter();
          expect(handler1).toHaveBeenCalled();
          expect(handler2).toHaveBeenCalled();
        },
      });

      await run(app);
    });
  });

  describe("Anonymous Middleware", () => {
    it("should create and use anonymous middleware", async () => {
      const order: string[] = [];

      const anonymousMiddleware = defineMiddleware({
        run: async ({ next }) => {
          order.push("anonymous middleware");
          return await next();
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [anonymousMiddleware],
        run: async () => {
          order.push("task execution");
          return "Task result";
        },
      });

      expect(typeof anonymousMiddleware.id).toBe("symbol");
      expect(anonymousMiddleware.id.toString()).toContain(
        "anonymous.test.middleware"
      );

      const app = defineResource({
        id: "app",
        register: [anonymousMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe("Task result");
        },
      });

      await run(app);

      expect(order).toEqual(["anonymous middleware", "task execution"]);
    });

    it("should create anonymous middleware with dependencies", async () => {
      const anonymousResource = defineResource({
        init: async () => "Middleware dependency",
      });

      const anonymousMiddleware = defineMiddleware({
        dependencies: { anonymousResource },
        run: async ({ next }, { anonymousResource }) => {
          const result = await next();
          return `${result} - ${anonymousResource}`;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [anonymousMiddleware],
        run: async () => "Original result",
      });

      expect(typeof anonymousMiddleware.id).toBe("symbol");
      expect(typeof anonymousResource.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousResource, anonymousMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe("Original result - Middleware dependency");
        },
      });

      await run(app);
    });

    it("should create anonymous middleware with configuration", async () => {
      const anonymousMiddleware = defineMiddleware({
        run: async ({ next }, _, config: { multiplier: number }) => {
          const result = await next();
          return result * config.multiplier;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [anonymousMiddleware.with({ multiplier: 3 })],
        run: async () => 10,
      });

      expect(typeof anonymousMiddleware.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result = await testTask();
          expect(result).toBe(30);
        },
      });

      await run(app);
    });

    it("should chain multiple anonymous middleware", async () => {
      const order: string[] = [];

      const middleware1 = defineMiddleware({
        run: async ({ next }) => {
          order.push("middleware1 before");
          const result = await next();
          order.push("middleware1 after");
          return result;
        },
      });

      const middleware2 = defineMiddleware({
        run: async ({ next }) => {
          order.push("middleware2 before");
          const result = await next();
          order.push("middleware2 after");
          return result;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        middleware: [middleware1, middleware2],
        run: async () => {
          order.push("task");
          return "Task executed";
        },
      });

      expect(typeof middleware1.id).toBe("symbol");
      expect(typeof middleware2.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [middleware1, middleware2, testTask],
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
  });

  describe("Complex Anonymous Combinations", () => {
    it("should work with all anonymous components together", async () => {
      const results: string[] = [];

      // Anonymous event
      const anonymousEvent = defineEvent<{ step: string }>({});

      // Anonymous resource
      const anonymousResource = defineResource({
        init: async () => ({ step: (name: string) => results.push(name) }),
      });

      // Anonymous middleware
      const anonymousMiddleware = defineMiddleware({
        dependencies: { anonymousResource },
        run: async ({ next }, { anonymousResource }) => {
          anonymousResource.step("middleware before");
          const result = await next();
          anonymousResource.step("middleware after");
          return result;
        },
      });

      // Anonymous task that emits event
      const anonymousEmitter = defineTask({
        dependencies: { anonymousEvent, anonymousResource },
        middleware: [anonymousMiddleware],
        run: async (_, { anonymousEvent, anonymousResource }) => {
          anonymousResource.step("task execution");
          await anonymousEvent({ step: "event emitted" });
          return "Emitter done";
        },
      });

      // Anonymous listener task
      const anonymousListener = defineTask({
        on: anonymousEvent,
        dependencies: { anonymousResource },
        run: async (event, { anonymousResource }) => {
          anonymousResource.step(`event received: ${event.data.step}`);
        },
      });

      // Verify all components are anonymous
      expect(typeof anonymousEvent.id).toBe("symbol");
      expect(typeof anonymousResource.id).toBe("symbol");
      expect(typeof anonymousMiddleware.id).toBe("symbol");
      expect(typeof anonymousEmitter.id).toBe("symbol");
      expect(typeof anonymousListener.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [
          anonymousEvent,
          anonymousResource,
          anonymousMiddleware,
          anonymousEmitter,
          anonymousListener,
        ],
        dependencies: { anonymousEmitter },
        async init(_, { anonymousEmitter }) {
          const result = await anonymousEmitter();
          expect(result).toBe("Emitter done");
          // Wait a bit for event processing to complete
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      });

      await run(app);

      expect(results).toEqual([
        "middleware before",
        "task execution",
        "event received: event emitted",
        "middleware after",
      ]);
    });

    it("should handle error suppression with anonymous components", async () => {
      const suppressMock = jest.fn();

      const anonymousTask = defineTask({
        run: async () => {
          throw new Error("Anonymous task failed");
        },
      });

      const anonymousErrorHandler = defineTask({
        on: anonymousTask.events.onError,
        run: async (event) => {
          suppressMock();
          event.data.suppress();
        },
      });

      expect(typeof anonymousTask.id).toBe("symbol");
      expect(typeof anonymousErrorHandler.id).toBe("symbol");

      const app = defineResource({
        id: "app",
        register: [anonymousTask, anonymousErrorHandler],
        dependencies: { anonymousTask },
        async init(_, { anonymousTask }) {
          const result = await anonymousTask();
          expect(result).toBeUndefined();
          return "App completed";
        },
      });

      const result = await run(app);
      expect(result.value).toBe("App completed");
      expect(suppressMock).toHaveBeenCalled();
    });
  });
});
