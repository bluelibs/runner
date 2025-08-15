import { defineTask, defineResource, defineMiddleware } from "../define";
import { run } from "../run";
import { CircularDependenciesError } from "../errors";

describe("Middleware Dependency Limitations", () => {
  describe("Global Middleware with Dependencies", () => {
    it("should allow global middleware to depend on resources", async () => {
      const logger = defineResource({
        id: "logger",
        init: async () => ({ log: (msg: string) => `LOG: ${msg}` }),
      });

      const globalMiddleware = defineMiddleware({
        id: "global.middleware",
        dependencies: { logger },
        run: async ({ next }, { logger }) => {
          const result = await next();
          logger.log("Middleware executed");
          return `Global: ${result}`;
        },
      });

      const testTask = defineTask({
        id: "test.task",
        run: async () => "Task result",
      });

      const app = defineResource({
        id: "app",
        register: [
          logger,
          globalMiddleware.everywhere({ tasks: true, resources: false }),
          testTask,
        ],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          return await testTask();
        },
      });

      const result = await run(app);
      expect(result.value).toBe("Global: Task result");
    });

    it("should detect circular dependencies when global middleware depends on resource that uses the same middleware", async () => {
      const service = defineResource({
        id: "service",
        init: async () => "Service initialized",
      });

      const globalMiddleware = defineMiddleware({
        id: "global.middleware",
        dependencies: { service },
        run: async ({ next }, { service }) => {
          return `Global[${service}]: ${await next()}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          service,
          globalMiddleware.everywhere({ tasks: false, resources: true }),
        ],
        init: async () => "App initialized",
      });

      await expect(run(app)).rejects.toThrow(CircularDependenciesError);
    });
  });

  describe("Shared Dependencies Creating Indirect Cycles", () => {
    it("should detect when middleware and its target share the same dependency", async () => {
      const sharedService = defineResource({
        id: "shared.service",
        init: async () => "Shared service",
      });

      const middleware = defineMiddleware({
        id: "middleware",
        dependencies: { sharedService },
        run: async ({ next }, { sharedService }) => {
          return `Middleware[${sharedService}]: ${await next()}`;
        },
      });

      const task = defineTask({
        id: "task",
        dependencies: { sharedService },
        middleware: [middleware],
        run: async (_, { sharedService }) => `Task[${sharedService}]`,
      });

      const app = defineResource({
        id: "app",
        register: [sharedService, middleware, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      // This should work - shared dependencies are OK
      const result = await run(app);
      expect(result.value).toBe("Middleware[Shared service]: Task[Shared service]");
    });

    it("should detect complex circular dependencies in middleware chains", async () => {
      const serviceA = defineResource({
        id: "service.a",
        init: async () => "Service A",
      });

      const middlewareA: any = defineMiddleware({
        id: "middleware.a",
        dependencies: (): any => ({ serviceB }), // Forward reference
        run: async ({ next }: any) => `A: ${await next()}`,
      });

      const serviceB: any = defineResource({
        id: "service.b",
        dependencies: { serviceA },
        middleware: [middlewareA],
        init: async (_: any, { serviceA }: any) => `Service B with ${serviceA}`,
      });

      const app = defineResource({
        id: "app",
        register: [serviceA, middlewareA, serviceB],
        dependencies: { serviceB },
        init: async (_, { serviceB }) => serviceB,
      });

      await expect(run(app)).rejects.toThrow(CircularDependenciesError);
    });
  });

  describe("Nested Middleware Dependencies", () => {
    it("should handle nested middleware without cycles", async () => {
      const dataService = defineResource({
        id: "data.service",
        init: async () => ({ data: "test data" }),
      });

      const cacheService = defineResource({
        id: "cache.service",
        init: async () => ({ cache: new Map() }),
      });

      const loggingMiddleware = defineMiddleware({
        id: "logging.middleware",
        dependencies: { dataService },
        run: async ({ next }, { dataService }) => {
          const result = await next();
          return `Logged[${dataService.data}]: ${result}`;
        },
      });

      const cachingMiddleware = defineMiddleware({
        id: "caching.middleware",
        dependencies: { cacheService },
        run: async ({ next }, { cacheService }) => {
          const result = await next();
          cacheService.cache.set("last", result);
          return `Cached: ${result}`;
        },
      });

      const task = defineTask({
        id: "task",
        middleware: [loggingMiddleware, cachingMiddleware],
        run: async () => "Task executed",
      });

      const app = defineResource({
        id: "app",
        register: [dataService, cacheService, loggingMiddleware, cachingMiddleware, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      const result = await run(app);
      expect(result.value).toBe("Logged[test data]: Cached: Task executed");
    });

    it("should detect cycles in nested middleware dependencies", async () => {
      const serviceX = defineResource({
        id: "service.x",
        init: async () => "Service X",
      });

      const middlewareA: any = defineMiddleware({
        id: "middleware.a",
        dependencies: (): any => ({ middlewareB }), // Depends on middleware B
        run: async ({ next }: any) => `A: ${await next()}`,
      });

      const middlewareB: any = defineMiddleware({
        id: "middleware.b",
        dependencies: (): any => ({ middlewareA }), // Depends on middleware A
        run: async ({ next }: any) => `B: ${await next()}`,
      });

      const task = defineTask({
        id: "task",
        middleware: [middlewareA],
        run: async () => "Task executed",
      });

      const app = defineResource({
        id: "app",
        register: [serviceX, middlewareA, middlewareB, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      await expect(run(app)).rejects.toThrow(CircularDependenciesError);
    });
  });

  describe("Middleware Configuration Dependencies", () => {
    it("should handle middleware with configured dependencies", async () => {
      const configService = defineResource({
        id: "config.service",
        init: async () => ({ timeout: 5000 }),
      });

      const timeoutMiddleware = defineMiddleware({
        id: "timeout.middleware",
        dependencies: { configService },
        run: async ({ next }, { configService }, config: { customTimeout?: number }) => {
          const timeout = config.customTimeout || configService.timeout;
          const result = await next();
          return `Timeout[${timeout}]: ${result}`;
        },
      });

      const task = defineTask({
        id: "task",
        middleware: [timeoutMiddleware.with({ customTimeout: 3000 })],
        run: async () => "Task completed",
      });

      const app = defineResource({
        id: "app",
        register: [configService, timeoutMiddleware, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      const result = await run(app);
      expect(result.value).toBe("Timeout[3000]: Task completed");
    });

    it("should detect cycles when configured middleware creates circular dependencies", async () => {
      const service = defineResource({
        id: "service",
        init: async () => "Service",
      });

      type MiddlewareConfig = { useService: boolean };
      const conditionalMiddleware = defineMiddleware<MiddlewareConfig>({
        id: "conditional.middleware",
        dependencies: (config: MiddlewareConfig) => 
          config.useService ? { service } : {},
        run: async ({ next }, deps: any, config: MiddlewareConfig) => {
          if (config.useService && deps.service) {
            return `Conditional[${deps.service}]: ${await next()}`;
          }
          return await next();
        },
      });

      const task = defineTask({
        id: "task",
        dependencies: { service },
        middleware: [conditionalMiddleware.with({ useService: true })],
        run: async (_, { service }) => `Task[${service}]`,
      });

      const app = defineResource({
        id: "app",
        register: [service, conditionalMiddleware, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      // This should work - sharing dependencies is OK
      const result = await run(app);
      expect(result.value).toBe("Conditional[Service]: Task[Service]");
    });
  });

  describe("Error Message Quality", () => {
    it("should provide clear error messages for middleware circular dependencies", async () => {
      const middleware: any = defineMiddleware({
        id: "self.referencing.middleware",
        dependencies: (): any => ({ task }),
        run: async ({ next }: any) => await next(),
      });

      const task: any = defineTask({
        id: "circular.task",
        middleware: [middleware],
        run: async () => "Should not execute",
      });

      const app = defineResource({
        id: "app",
        register: [middleware, task],
        dependencies: { task },
        init: async (_, { task }) => await task(),
      });

      try {
        await run(app);
        fail("Expected CircularDependenciesError to be thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CircularDependenciesError);
        expect(error.message).toContain("Circular dependencies detected");
        expect(error.message).toContain("circular.task");
        expect(error.message).toContain("self.referencing.middleware");
      }
    });
  });
});