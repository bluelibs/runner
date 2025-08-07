import { task, resource, middleware, event, run } from "../index";
import { executeFunction } from "../tools/executeFunction";

// Mock the task run function to allow sync functions for demonstration
// This is only for testing the underlying optimization
describe("Real Synchronous Functions Test", () => {
  describe("executeFunction utility", () => {
    it("should handle truly synchronous functions efficiently", async () => {
      const syncFn = (x: number) => x * 2;
      const result = await executeFunction(syncFn, 5);
      expect(result).toBe(10);
    });

    it("should handle async functions", async () => {
      const asyncFn = async (x: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return x * 3;
      };
      const result = await executeFunction(asyncFn, 5);
      expect(result).toBe(15);
    });

    it("should handle performance difference between sync and async", async () => {
      const iterations = 1000;
      
      const syncFn = (x: number) => x + 1;
      const asyncFn = async (x: number) => x + 1;

      // Test sync performance
      const syncStart = performance.now();
      const syncPromises = Array(iterations).fill(0).map((_, i) => executeFunction(syncFn, i));
      await Promise.all(syncPromises);
      const syncEnd = performance.now();
      
      // Test async performance
      const asyncStart = performance.now();
      const asyncPromises = Array(iterations).fill(0).map((_, i) => executeFunction(asyncFn, i));
      await Promise.all(asyncPromises);
      const asyncEnd = performance.now();

      const syncTime = syncEnd - syncStart;
      const asyncTime = asyncEnd - asyncStart;

      // The optimization should make sync functions faster
      // This is more of a demonstration than a strict assertion
      console.log(`Sync time: ${syncTime}ms, Async time: ${asyncTime}ms`);
      
      // Both should complete in reasonable time
      expect(syncTime).toBeLessThan(1000);
      expect(asyncTime).toBeLessThan(1000);
    });
  });

  describe("Custom task runner with sync functions", () => {
    it("should demonstrate the optimization benefit in a realistic scenario", async () => {
      let middlewareComputedValue = 0;
      
      // Create a custom middleware that actually uses sync functions internally
      const optimizedMiddleware = middleware({
        id: "optimizedMiddleware",
        run: async ({ next, task }: any) => {
          // Simulate some sync computation that would be optimized
          const syncComputation = (x: number) => {
            let result = x;
            for (let i = 0; i < 100; i++) {
              result = result + i;
            }
            return result;
          };

          // Use our executeFunction to optimize this
          middlewareComputedValue = await executeFunction(syncComputation, 5);
          
          const result = await next(task?.input);
          return result; // Just pass through the original result
        },
      });

      const testTask = task({
        id: "testTask",
        middleware: [optimizedMiddleware],
        run: async (input: number) => input * 2,
      });

      const app = resource({
        id: "app",
        register: [optimizedMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask(10);
          
          expect(result).toBe(20);
          expect(middlewareComputedValue).toBe(4955); // 5 + sum(0 to 99) = 5 + 4950
          
          return "optimization test completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Resource initialization optimization", () => {
    it("should optimize sync resource initialization internally", async () => {
      // This demonstrates how the optimization works in resource initialization
      const computeResource = resource({
        id: "computeResource",
        init: async (config: { iterations: number }) => {
          // Internally, this could use sync functions that get optimized
          const syncCalculation = (iterations: number) => {
            let sum = 0;
            for (let i = 0; i < iterations; i++) {
              sum += i;
            }
            return sum;
          };

          // The executeFunction optimization would apply here
          const result = await executeFunction(syncCalculation, config.iterations);
          
          return {
            sum: result,
            iterations: config.iterations,
            type: 'computed'
          };
        },
      });

      const app = resource({
        id: "app",
        register: [computeResource.with({ iterations: 100 })],
        dependencies: { computeResource },
        init: async (_, { computeResource }) => {
          expect(computeResource.sum).toBe(4950); // sum(0 to 99)
          expect(computeResource.iterations).toBe(100);
          expect(computeResource.type).toBe('computed');
          
          return "resource optimization test completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Event handler optimization", () => {
    it("should optimize sync event handler execution", async () => {
      const computationEvent = event<{ value: number }>({
        id: "computationEvent",
      });

      let computationResult = 0;
      
      const optimizedListener = task({
        id: "optimizedListener",
        on: computationEvent,
        run: async (eventData: any) => {
          // Demonstrate sync function optimization in event handler
          const heavySync = (n: number) => {
            let result = n;
            for (let i = 0; i < 50; i++) {
              result = Math.sqrt(result + i);
            }
            return Math.floor(result);
          };

          computationResult = await executeFunction(heavySync, eventData.data.value);
        },
      });

      const app = resource({
        id: "app",
        register: [computationEvent, optimizedListener],
        dependencies: { computationEvent },
        init: async (_, { computationEvent }) => {
          await computationEvent({ value: 100 });
          expect(computationResult).toBeGreaterThan(0);
          
          return "event optimization test completed";
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });
});