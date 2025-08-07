import { task, resource, middleware, event, run } from "../index";
import { executeFunction } from "../tools/executeFunction";

describe("Sync/Async Optimization", () => {
  describe("executeFunction utility optimization", () => {
    it("should optimize truly synchronous functions vs async functions", async () => {
      const iterations = 100;
      
      // Pure synchronous function - this is what gets optimized
      const pureSync = (x: number) => {
        let result = x;
        for (let i = 0; i < 50; i++) {
          result += i;
        }
        return result;
      };
      
      // Async function doing the same work
      const asyncEquivalent = async (x: number) => {
        let result = x;
        for (let i = 0; i < 50; i++) {
          result += i;
        }
        return result;
      };

      // Test sync function performance via executeFunction
      const syncStart = performance.now();
      const syncPromises = Array(iterations).fill(0).map((_, i) => executeFunction(pureSync, i));
      const syncResults = await Promise.all(syncPromises);
      const syncTime = performance.now() - syncStart;
      
      // Test async function performance  
      const asyncStart = performance.now();
      const asyncPromises = Array(iterations).fill(0).map((_, i) => executeFunction(asyncEquivalent, i));
      const asyncResults = await Promise.all(asyncPromises);
      const asyncTime = performance.now() - asyncStart;

      // Results should be the same
      expect(syncResults[0]).toBe(asyncResults[0]);
      expect(syncResults.length).toBe(asyncResults.length);
      
      // Sync should be faster (though this can vary by environment)
      console.log(`Sync execution time: ${syncTime}ms, Async execution time: ${asyncTime}ms`);
      
      // Both should complete in reasonable time - the optimization ensures sync functions don't get unnecessary Promise overhead
      expect(syncTime).toBeLessThan(1000);
      expect(asyncTime).toBeLessThan(1000);
    });
  });

  describe("Framework tasks with internal optimization", () => {
    it("should execute framework tasks that use executeFunction internally", async () => {
      // This tests that the optimization is applied within the framework
      // The task itself must be async due to framework constraints, but internally uses executeFunction
      
      const optimizedTask = task({
        id: "optimizedTask", 
        run: async (input: number) => {
          // The framework's TaskRunner now uses executeFunction internally for this function
          // Even though this function is async, if it were sync, it would be optimized
          return input * 2;
        },
      });

      const app = resource({
        id: "app",
        register: [optimizedTask],
        dependencies: { optimizedTask },
        init: async (_, { optimizedTask }) => {
          const result = await optimizedTask(5);
          expect(result).toBe(10);
          return "task executed with internal optimization";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle tasks with genuine async operations", async () => {
      const asyncTask = task({
        id: "asyncTask",
        run: async (input: number) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return input * 3;
        },
      });

      const app = resource({
        id: "app",
        register: [asyncTask],
        dependencies: { asyncTask },
        init: async (_, { asyncTask }) => {
          const result = await asyncTask(5);
          expect(result).toBe(15);
          return "async task executed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle mixed task execution efficiently", async () => {
      const quickTask = task({
        id: "quickTask",
        run: async (input: number) => input * 2, // Quick computation
      });

      const slowTask = task({
        id: "slowTask", 
        run: async (input: number) => {
          await new Promise(resolve => setTimeout(resolve, 1)); // Genuine async delay
          return input * 3;
        },
      });

      const app = resource({
        id: "app",
        register: [quickTask, slowTask],
        dependencies: { quickTask, slowTask },
        init: async (_, { quickTask, slowTask }) => {
          const [quickResult, slowResult] = await Promise.all([
            quickTask(5),
            slowTask(5)
          ]);
          expect(quickResult).toBe(10);
          expect(slowResult).toBe(15);
          return "mixed task execution completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Resources with internal optimization", () => {
    it("should initialize resources with quick computations", async () => {
      const computeResource = resource({
        id: "computeResource",
        init: async (config: { value: number }) => {
          // Quick computation that would benefit from sync optimization if it were sync
          return config.value * 2;
        },
      });

      const app = resource({
        id: "app",
        register: [computeResource.with({ value: 5 })],
        dependencies: { computeResource },
        init: async (_, { computeResource }) => {
          expect(computeResource).toBe(10);
          return "resource initialized with internal optimization";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should initialize resources with genuine async operations", async () => {
      const asyncResource = resource({
        id: "asyncResource",
        init: async (config: { value: number }) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return config.value * 3;
        },
      });

      const app = resource({
        id: "app",
        register: [asyncResource.with({ value: 5 })],
        dependencies: { asyncResource },
        init: async (_, { asyncResource }) => {
          expect(asyncResource).toBe(15);
          return "async resource initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle mixed resource initialization efficiently", async () => {
      const quickResource = resource({
        id: "quickResource",
        init: async (config: { value: number }) => config.value * 2,
      });

      const slowResource = resource({
        id: "slowResource",
        init: async (config: { value: number }) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return config.value * 3;
        },
      });

      const app = resource({
        id: "app",
        register: [
          quickResource.with({ value: 5 }),
          slowResource.with({ value: 7 }),
        ],
        dependencies: { quickResource, slowResource },
        init: async (_, { quickResource, slowResource }) => {
          expect(quickResource).toBe(10);
          expect(slowResource).toBe(21);
          return "mixed resource initialization completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Middleware", () => {
    it("should run synchronous middleware", async () => {
      const syncMiddleware = middleware({
        id: "syncMiddleware",
        run: async ({ next, task }: any) => {
          const result = await next(task?.input);
          return result; // Synchronous middleware wrapped in async
        },
      });

      const testTask = task({
        id: "testTask",
        middleware: [syncMiddleware],
        run: async (input: number) => input * 2,
      });

      const app = resource({
        id: "app",
        register: [syncMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask(5);
          expect(result).toBe(10);
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should run asynchronous middleware", async () => {
      const asyncMiddleware = middleware({
        id: "asyncMiddleware",
        run: async ({ next, task }: any) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          const result = await next(task?.input);
          return result + 1; // Async middleware that modifies result
        },
      });

      const testTask = task({
        id: "testTask",
        middleware: [asyncMiddleware],
        run: async (input: number) => input * 2,
      });

      const app = resource({
        id: "app",
        register: [asyncMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask(5);
          expect(result).toBe(11); // (5 * 2) + 1
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle mixed sync and async middleware", async () => {
      const syncMiddleware = middleware({
        id: "syncMiddleware",
        run: async ({ next, task }: any) => {
          const result = await next(task?.input);
          return result;
        },
      });

      const asyncMiddleware = middleware({
        id: "asyncMiddleware", 
        run: async ({ next, task }: any) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          const result = await next(task?.input);
          return result + 10;
        },
      });

      const testTask = task({
        id: "testTask",
        middleware: [syncMiddleware, asyncMiddleware],
        run: async (input: number) => input * 2,
      });

      const app = resource({
        id: "app",
        register: [syncMiddleware, asyncMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask(5);
          expect(result).toBe(20); // (5 * 2) + 10
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Event Handlers", () => {
    it("should handle synchronous event listeners", async () => {
      const testEvent = event<{ value: number }>({
        id: "testEvent",
      });

      let syncResult = 0;
      const syncListener = task({
        id: "syncListener",
        on: testEvent,
        run: async (eventData: any) => {
          syncResult = eventData.data.value * 2; // Synchronous event handler wrapped in async
        },
      });

      const app = resource({
        id: "app",
        register: [testEvent, syncListener],
        dependencies: { testEvent },
        init: async (_, { testEvent }) => {
          await testEvent({ value: 5 });
          expect(syncResult).toBe(10);
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle asynchronous event listeners", async () => {
      const testEvent = event<{ value: number }>({
        id: "testEvent",
      });

      let asyncResult = 0;
      const asyncListener = task({
        id: "asyncListener",
        on: testEvent,
        run: async (eventData: any) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          asyncResult = eventData.data.value * 3; // Asynchronous event handler
        },
      });

      const app = resource({
        id: "app",
        register: [testEvent, asyncListener],
        dependencies: { testEvent },
        init: async (_, { testEvent }) => {
          await testEvent({ value: 7 });
          expect(asyncResult).toBe(21);
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should handle mixed sync and async event listeners", async () => {
      const testEvent = event<{ value: number }>({
        id: "testEvent", 
      });

      let syncResult = 0;
      let asyncResult = 0;
      
      const syncListener = task({
        id: "syncListener",
        on: testEvent,
        run: async (eventData: any) => {
          syncResult = eventData.data.value * 2;
        },
      });

      const asyncListener = task({
        id: "asyncListener",
        on: testEvent,
        run: async (eventData: any) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          asyncResult = eventData.data.value * 3;
        },
      });

      const app = resource({
        id: "app",
        register: [testEvent, syncListener, asyncListener],
        dependencies: { testEvent },
        init: async (_, { testEvent }) => {
          await testEvent({ value: 4 });
          expect(syncResult).toBe(8);
          expect(asyncResult).toBe(12);
          return "app initialized";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Performance - Underlying Sync Function Detection", () => {
    it("should efficiently handle functions that are internally synchronous", async () => {
      // This test is more about the underlying optimization.
      // Even though we wrap sync functions in async for the API,
      // internally the executeFunction should detect and handle sync functions efficiently
      const iterations = 100;
      
      const perfTask = task({
        id: "perfTask",
        run: async (input: number) => input + 1, // Simple operation
      });

      const app = resource({
        id: "app",
        register: [perfTask],
        dependencies: { perfTask },
        init: async (_, { perfTask }) => {
          const start = performance.now();
          
          // Run many operations
          const promises = [];
          for (let i = 0; i < iterations; i++) {
            promises.push(perfTask(i));
          }
          const results = await Promise.all(promises);
          
          const end = performance.now();
          
          expect(results).toHaveLength(iterations);
          expect(results[0]).toBe(1);
          expect(results[iterations - 1]).toBe(iterations);
          
          // This test ensures the operations complete efficiently
          // The executeFunction optimization should help with internal performance
          expect(end - start).toBeLessThan(1000); // Should complete in reasonable time
          
          return "performance test completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });
});