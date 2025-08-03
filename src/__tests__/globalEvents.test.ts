import { globalEvents } from "../globals/globalEvents";
import { defineTask, defineResource, defineMiddleware, defineEvent } from "../define";
import { run } from "../run";

describe("Global Events", () => {
  it("should emit global events during resource initialization and task execution", async () => {
    const globalBeforeInitHandler = jest.fn();
    const globalAfterInitHandler = jest.fn();
    const globalTaskBeforeRunHandler = jest.fn();
    const globalTaskAfterRunHandler = jest.fn();
    const globalResourceBeforeInitHandler = jest.fn();
    const globalResourceAfterInitHandler = jest.fn();

    const testResource = defineResource({
      id: "test.resource",
      init: async () => "Resource Value",
    });

    const testTask = defineTask({
      id: "test.task",
      run: async () => {
        return "Task Result";
      },
    });

    const taskBeforeInit = defineTask({
      id: "task.beforeInit",
      on: globalEvents.beforeInit,
      run: globalBeforeInitHandler,
    });

    const taskAfterInit = defineTask({
      id: "task.afterInit",
      on: globalEvents.afterInit,
      run: globalAfterInitHandler,
    });

    const taskBeforeRun = defineTask({
      id: "task.beforeRun",
      on: globalEvents.tasks.beforeRun,
      run: globalTaskBeforeRunHandler,
    });

    const taskAfterRun = defineTask({
      id: "task.afterRun",
      on: globalEvents.tasks.afterRun,
      run: globalTaskAfterRunHandler,
    });

    const resourceBeforeInit = defineTask({
      id: "resource.beforeInit",
      on: globalEvents.resources.beforeInit,
      run: globalResourceBeforeInitHandler,
    });

    const resourceAfterInit = defineTask({
      id: "resource.afterInit",
      on: globalEvents.resources.afterInit,
      run: globalResourceAfterInitHandler,
    });

    const app = defineResource({
      id: "app",
      register: [
        testResource,
        testTask,
        taskBeforeInit,
        taskAfterInit,
        taskBeforeRun,
        taskAfterRun,
        resourceBeforeInit,
        resourceAfterInit,
      ],
      dependencies: { testResource, testTask },
      async init(_, { testResource, testTask }) {
        expect(testResource).toBe("Resource Value");
        const response = await testTask();
      },
    });

    await run(app);

    expect(globalBeforeInitHandler).toHaveBeenCalled();
    expect(globalAfterInitHandler).toHaveBeenCalled();
    expect(globalResourceBeforeInitHandler).toHaveBeenCalled();
    expect(globalResourceAfterInitHandler).toHaveBeenCalled();
    expect(globalTaskBeforeRunHandler).toHaveBeenCalled();
    expect(globalTaskAfterRunHandler).toHaveBeenCalled();
  });

  it("should emit global error event when an task throws an error", async () => {
    const globalTaskOnErrorHandler = jest.fn();

    const errorTask = defineTask({
      id: "error.task",
      run: async () => {
        throw new Error("Test Error");
      },
    });

    const onErrorHandler = defineTask({
      id: "on.error.handler",
      on: globalEvents.tasks.onError,
      run: globalTaskOnErrorHandler,
    });

    const app = defineResource({
      id: "app",
      register: [errorTask, onErrorHandler],
      dependencies: { errorTask },
      async init(_, { errorTask }) {
        try {
          await errorTask();
        } catch (error) {
          // Error is expected
        }
      },
    });

    await run(app);

    expect(globalTaskOnErrorHandler).toHaveBeenCalled();
  });

  it("should ensure global event listeners get their middleware called", async () => {
    const middlewareExecutions: string[] = [];
    const eventHandlerExecutions: string[] = [];

    // Custom event to emit
    const customEvent = defineEvent<{ message: string }>({
      id: "test.customEvent",
      meta: {
        title: "Test Event",
        description: "Test event for middleware verification",
        tags: ["test"],
      },
    });

    // Middleware that logs execution
    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next, task }) => {
        const taskId = task?.definition?.id || "unknown";
        middlewareExecutions.push(`middleware-before:${String(taskId)}`);
        const result = await next(task?.input);
        middlewareExecutions.push(`middleware-after:${String(taskId)}`);
        return result;
      },
    });

    // Global event listener task with middleware
    const globalEventHandler = defineTask({
      id: "global.event.handler",
      on: "*", // Global listener
      middleware: [testMiddleware],
      run: async (event) => {
        if (event && event.id) {
          eventHandlerExecutions.push(`global-handler:${event.id.toString()}`);
          // Verify the event has meta included
          expect(event.meta).toBeDefined();
          if (event.id === customEvent.id) {
            expect(event.meta.title).toBe("Test Event");
            expect(event.meta.tags).toContain("test");
            expect(event.data.message).toBe("Hello from custom event");
          }
        }
      },
    });

    // Specific event listener task with middleware
    const specificEventHandler = defineTask({
      id: "specific.event.handler",
      on: customEvent,
      middleware: [testMiddleware],
      run: async (event) => {
        if (event && event.id) {
          eventHandlerExecutions.push(`specific-handler:${event.id.toString()}`);
          expect(event.meta.title).toBe("Test Event");
          expect(event.data.message).toBe("Hello from custom event");
        }
      },
    });

    // Task that emits the custom event
    const eventEmitter = defineTask({
      id: "event.emitter",
      dependencies: { customEvent },
      run: async (_, { customEvent }) => {
        await customEvent({ message: "Hello from custom event" });
        return "Event emitted";
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        customEvent,
        testMiddleware,
        globalEventHandler,
        specificEventHandler,
        eventEmitter,
      ],
      dependencies: { eventEmitter },
      async init(_, { eventEmitter }) {
        await eventEmitter();
      },
    });

    await run(app);

    // Verify middleware was called for global event listener
    expect(middlewareExecutions).toContain("middleware-before:global.event.handler");
    expect(middlewareExecutions).toContain("middleware-after:global.event.handler");

    // Verify middleware was called for specific event listener
    expect(middlewareExecutions).toContain("middleware-before:specific.event.handler");
    expect(middlewareExecutions).toContain("middleware-after:specific.event.handler");

    // Verify event handlers were executed
    expect(eventHandlerExecutions).toContain("global-handler:test.customEvent");
    expect(eventHandlerExecutions).toContain("specific-handler:test.customEvent");

    // Verify global listeners also handle other events (like global events themselves)
    expect(eventHandlerExecutions.some(exec => 
      exec.includes("global-handler:") && exec.includes("beforeInit")
    )).toBe(true);
  });

  it("should support stopPropagation in event listeners", async () => {
    const eventHandlerExecutions: string[] = [];

    const testEvent = defineEvent<{ value: number }>({
      id: "test.propagationEvent",
      meta: {
        title: "Propagation Test Event",
        tags: ["propagation", "test"],
      },
    });

    // High priority listener that stops propagation
    const highPriorityHandler = defineTask({
      id: "high.priority.handler",
      on: testEvent,
      listenerOrder: -100, // Higher priority (runs first)
      run: async (event) => {
        eventHandlerExecutions.push("high-priority-executed");
        
        if (event && event.data && event.data.value > 10) {
          event.stopPropagation();
          eventHandlerExecutions.push("propagation-stopped");
        }
      },
    });

    // Low priority listener that should be skipped when propagation is stopped
    const lowPriorityHandler = defineTask({
      id: "low.priority.handler",
      on: testEvent,
      listenerOrder: 100, // Lower priority (runs later)
      run: async () => {
        // This handler will only execute when propagation is NOT stopped
        eventHandlerExecutions.push("low-priority-executed");
      },
    });

    const eventEmitter = defineTask({
      id: "propagation.emitter",
      dependencies: { testEvent },
      run: async (value: number, { testEvent }) => {
        await testEvent({ value });
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        testEvent,
        highPriorityHandler,
        lowPriorityHandler,
        eventEmitter,
      ],
      dependencies: { eventEmitter },
      async init(_, { eventEmitter }) {
        // Test with value <= 10 (no propagation stop)
        await eventEmitter(5);
        
        // Test with value > 10 (propagation stop)
        await eventEmitter(15);
      },
    });

    await run(app);

    // Verify both handlers executed for first event (value=5)
    expect(eventHandlerExecutions.filter(e => e === "high-priority-executed")).toHaveLength(2);
    expect(eventHandlerExecutions.filter(e => e === "low-priority-executed")).toHaveLength(1);
    
    // Verify propagation was stopped for second event (value=15)
    expect(eventHandlerExecutions.filter(e => e === "propagation-stopped")).toHaveLength(1);
    
    // The low priority handler should NOT have run for the second event due to stopped propagation
    // So it should only appear once (from the first event where propagation was not stopped)
  });

  it("should support global event listeners with both global and local middleware", async () => {
    const middlewareExecutions: string[] = [];
    const eventHandlerExecutions: string[] = [];

    // Custom event to emit
    const testEvent = defineEvent<{ message: string }>({
      id: "test.globalMiddlewareEvent",
      meta: {
        title: "Global Middleware Test Event",
        description: "Test event for global middleware verification",
        tags: ["test", "global"],
      },
    });

    // Global middleware that should be applied everywhere
    const globalMiddleware = defineMiddleware({
      id: "global.middleware",
      run: async ({ next, task }) => {
        const taskId = task?.definition?.id || "unknown";
        middlewareExecutions.push(`global-middleware-before:${String(taskId)}`);
        const result = await next(task?.input);
        middlewareExecutions.push(`global-middleware-after:${String(taskId)}`);
        return result;
      },
    }).everywhere(); // Make it global

    // Local middleware specific to certain tasks
    const localMiddleware = defineMiddleware({
      id: "local.middleware",
      run: async ({ next, task }) => {
        const taskId = task?.definition?.id || "unknown";
        middlewareExecutions.push(`local-middleware-before:${String(taskId)}`);
        const result = await next(task?.input);
        middlewareExecutions.push(`local-middleware-after:${String(taskId)}`);
        return result;
      },
    });

    // Global event listener task with local middleware
    const globalEventHandler = defineTask({
      id: "global.middleware.event.handler",
      on: "*", // Global listener
      middleware: [localMiddleware], // Local middleware
      run: async (event) => {
        if (event && event.id) {
          eventHandlerExecutions.push(`global-handler:${event.id.toString()}`);
          if (event.id === testEvent.id) {
            expect(event.meta.title).toBe("Global Middleware Test Event");
            expect(event.data.message).toBe("Hello from middleware test");
          }
        }
      },
    });

    // Specific event listener task with local middleware
    const specificEventHandler = defineTask({
      id: "specific.middleware.event.handler",
      on: testEvent,
      middleware: [localMiddleware], // Local middleware
      run: async (event) => {
        if (event && event.id) {
          eventHandlerExecutions.push(`specific-handler:${event.id.toString()}`);
          expect(event.meta.title).toBe("Global Middleware Test Event");
          expect(event.data.message).toBe("Hello from middleware test");
        }
      },
    });

    // Task that emits the test event
    const eventEmitter = defineTask({
      id: "middleware.event.emitter",
      dependencies: { testEvent },
      middleware: [localMiddleware], // This task also has local middleware
      run: async (_, { testEvent }) => {
        await testEvent({ message: "Hello from middleware test" });
        return "Event emitted";
      },
    });

    const app = defineResource({
      id: "app",
      register: [
        globalMiddleware, // Register global middleware
        localMiddleware,
        testEvent,
        globalEventHandler,
        specificEventHandler,
        eventEmitter,
      ],
      dependencies: { eventEmitter },
      async init(_, { eventEmitter }) {
        await eventEmitter();
      },
    });

    await run(app);

    // Verify global middleware was called for global event listener
    expect(middlewareExecutions).toContain("global-middleware-before:global.middleware.event.handler");
    expect(middlewareExecutions).toContain("global-middleware-after:global.middleware.event.handler");

    // Verify local middleware was called for global event listener
    expect(middlewareExecutions).toContain("local-middleware-before:global.middleware.event.handler");
    expect(middlewareExecutions).toContain("local-middleware-after:global.middleware.event.handler");

    // Verify global middleware was called for specific event listener
    expect(middlewareExecutions).toContain("global-middleware-before:specific.middleware.event.handler");
    expect(middlewareExecutions).toContain("global-middleware-after:specific.middleware.event.handler");

    // Verify local middleware was called for specific event listener
    expect(middlewareExecutions).toContain("local-middleware-before:specific.middleware.event.handler");
    expect(middlewareExecutions).toContain("local-middleware-after:specific.middleware.event.handler");

    // Verify global middleware was called for event emitter task
    expect(middlewareExecutions).toContain("global-middleware-before:middleware.event.emitter");
    expect(middlewareExecutions).toContain("global-middleware-after:middleware.event.emitter");

    // Verify local middleware was called for event emitter task
    expect(middlewareExecutions).toContain("local-middleware-before:middleware.event.emitter");
    expect(middlewareExecutions).toContain("local-middleware-after:middleware.event.emitter");

    // Verify event handlers were executed
    expect(eventHandlerExecutions).toContain("global-handler:test.globalMiddlewareEvent");
    expect(eventHandlerExecutions).toContain("specific-handler:test.globalMiddlewareEvent");

    // Verify global listeners also handle other events (like global events themselves)
    expect(eventHandlerExecutions.some(exec => 
      exec.includes("global-handler:") && exec.includes("beforeInit")
    )).toBe(true);
  });
});
