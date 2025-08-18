import { defineTask, defineResource, defineMiddleware } from "../define";
import { globalResources } from "../globals/globalResources";
import { run } from "../run";

describe("Dynamic Register and Dependencies", () => {
  describe("Dynamic Dependencies", () => {
    it("should support function-based dependencies", async () => {
      const serviceA = defineResource({
        id: "service.a",
        init: async () => "Service A",
      });

      const serviceB = defineResource({
        id: "service.b",
        init: async () => "Service B",
      });

      const dynamicService = defineResource({
        id: "service.dynamic",
        dependencies: () => ({
          a: serviceA,
          b: serviceB,
        }),
        init: async (_, { a, b }) => `Dynamic service with ${a} and ${b}`,
      });

      const app = defineResource({
        id: "app",
        register: [serviceA, serviceB, dynamicService],
        dependencies: { dynamicService },
        init: async (_, { dynamicService }) => {
          expect(dynamicService).toBe(
            "Dynamic service with Service A and Service B",
          );
        },
      });

      await run(app);
    });

    it("should support conditional dependencies based on environment", async () => {
      const prodService = defineResource({
        id: "service.prod",
        init: async () => "Production Service",
      });

      const devService = defineResource({
        id: "service.dev",
        init: async () => "Development Service",
      });

      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const conditionalService = defineResource({
        id: "service.conditional",
        dependencies: () => ({
          service:
            process.env.NODE_ENV === "production" ? prodService : devService,
        }),
        init: async (_, { service }) => `Using ${service}`,
      });

      const app = defineResource({
        id: "app",
        register: [prodService, devService, conditionalService],
        dependencies: { conditionalService },
        init: async (_, { conditionalService }) => {
          expect(conditionalService).toBe("Using Production Service");
        },
      });

      await run(app);

      // Test dev environment
      process.env.NODE_ENV = "development";

      const conditionalServiceDev = defineResource({
        id: "service.conditional.dev",
        dependencies: () => ({
          service:
            process.env.NODE_ENV === "production" ? prodService : devService,
        }),
        init: async (_, { service }) => `Using ${service}`,
      });

      const appDev = defineResource({
        id: "app.dev",
        register: [prodService, devService, conditionalServiceDev],
        dependencies: { conditionalService: conditionalServiceDev },
        init: async (_, { conditionalService }) => {
          expect(conditionalService).toBe("Using Development Service");
        },
      });

      await run(appDev);

      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });

    it("should support forward references in function dependencies", async () => {
      // Define resourceB first, which depends on resourceA (defined later)
      const resourceB = defineResource({
        id: "resource.b",
        dependencies: () => ({ a: resourceA }), // Forward reference
        init: async (_, { a }) => `B depends on ${a}`,
      });

      const resourceA = defineResource({
        id: "resource.a",
        init: async () => "A",
      });

      const app = defineResource({
        id: "app",
        register: [resourceA, resourceB],
        dependencies: { resourceB },
        init: async (_, { resourceB }) => {
          expect(resourceB).toBe("B depends on A");
        },
      });

      await run(app);
    });

    it("should support dependencies with configurations", async () => {
      type ServiceConfig = { name: string; version: number };

      const baseService = defineResource({
        id: "service.base",
        init: async (config: ServiceConfig) =>
          `${config.name} v${config.version}`,
      });

      const dynamicService = defineResource({
        id: "service.dynamic",
        register: [baseService.with({ name: "Dynamic Base", version: 2 })],
        dependencies: { baseService },
        init: async (_, { baseService }) =>
          `Dynamic service using ${baseService}`,
      });

      const app = defineResource({
        id: "app",
        register: [dynamicService],
        dependencies: { dynamicService },
        init: async (_, { dynamicService }) => {
          expect(dynamicService).toBe("Dynamic service using Dynamic Base v2");
        },
      });

      await run(app);
    });
  });

  describe("Dynamic Register", () => {
    it("should support function-based register", async () => {
      const serviceA = defineResource({
        id: "service.a",
        init: async () => "Service A",
      });

      const serviceB = defineResource({
        id: "service.b",
        init: async () => "Service B",
      });

      const dynamicApp = defineResource({
        id: "app.dynamic",
        register: () => [serviceA, serviceB],
        dependencies: { serviceA, serviceB },
        init: async (_, { serviceA, serviceB }) => {
          expect(serviceA).toBe("Service A");
          expect(serviceB).toBe("Service B");
        },
      });

      const { getResourceValue } = await run(dynamicApp);

      const store = getResourceValue(globalResources.store);

      expect(store.resources.has(dynamicApp.id)).toBe(true);
      expect(
        store.resources.get(dynamicApp.id).resource.register,
      ).toBeInstanceOf(Array);
      expect(store.resources.get(dynamicApp.id).resource.register).toHaveLength(
        2,
      );
      expect(store.resources.get(dynamicApp.id).resource.register).toContain(
        serviceA,
      );
      expect(store.resources.get(dynamicApp.id).resource.register).toContain(
        serviceB,
      );
    });

    it("should support conditional registration based on environment", async () => {
      const prodService = defineResource({
        id: "service.prod",
        init: async () => "Production Service",
      });

      const devService = defineResource({
        id: "service.dev",
        init: async () => "Development Service",
      });

      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const conditionalApp = defineResource({
        id: "app.conditional",
        register: () => [
          process.env.NODE_ENV === "production" ? prodService : devService,
        ],
        dependencies: () => ({
          service:
            process.env.NODE_ENV === "production" ? prodService : devService,
        }),
        init: async (_, { service }) => {
          expect(service).toBe("Production Service");
        },
      });

      await run(conditionalApp);

      // Test with development environment
      process.env.NODE_ENV = "development";

      const conditionalAppDev = defineResource({
        id: "app.conditional.dev",
        register: () => [
          process.env.NODE_ENV === "production" ? prodService : devService,
        ],
        dependencies: () => ({
          service:
            process.env.NODE_ENV === "production" ? prodService : devService,
        }),
        init: async (_, { service }) => {
          expect(service).toBe("Development Service");
        },
      });

      await run(conditionalAppDev);

      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });

    it("should support dynamic registration with configurations", async () => {
      type DatabaseConfig = { host: string; port: number };

      const database = defineResource({
        id: "database",
        init: async (config: DatabaseConfig) =>
          `DB at ${config.host}:${config.port}`,
      });

      const app = defineResource({
        id: "app",
        register: () => [
          database.with({
            host: process.env.DB_HOST || "localhost",
            port: parseInt(process.env.DB_PORT || "5432"),
          }),
        ],
        dependencies: { database },
        init: async (_, { database }) => {
          expect(database).toBe("DB at localhost:5432");
        },
      });

      await run(app);

      // Test with environment variables
      const originalHost = process.env.DB_HOST;
      const originalPort = process.env.DB_PORT;

      process.env.DB_HOST = "prod-db";
      process.env.DB_PORT = "3306";

      const appWithEnv = defineResource({
        id: "app.env",
        register: () => [
          database.with({
            host: process.env.DB_HOST || "localhost",
            port: parseInt(process.env.DB_PORT || "5432"),
          }),
        ],
        dependencies: { database },
        init: async (_, { database }) => {
          expect(database).toBe("DB at prod-db:3306");
        },
      });

      await run(appWithEnv);

      // Restore environment variables
      if (originalHost !== undefined) {
        process.env.DB_HOST = originalHost;
      } else {
        delete process.env.DB_HOST;
      }
      if (originalPort !== undefined) {
        process.env.DB_PORT = originalPort;
      } else {
        delete process.env.DB_PORT;
      }
    });
  });

  describe("Resource Configurations in Dependencies", () => {
    it("should pass configurations to resources in dependencies", async () => {
      type LoggerConfig = { level: string; prefix: string };

      const logger = defineResource({
        id: "logger",
        init: async (config: LoggerConfig) => ({
          log: (message: string) =>
            `[${config.level}] ${config.prefix}: ${message}`,
          config,
        }),
      });

      const service = defineResource({
        id: "service",
        register: [logger.with({ level: "INFO", prefix: "SERVICE" })],
        dependencies: { logger },
        init: async (_, { logger }) => {
          expect((logger as any).config.level).toBe("INFO");
          expect((logger as any).config.prefix).toBe("SERVICE");
          return (logger as any).log("Service initialized");
        },
      });

      const app = defineResource({
        id: "app",
        register: [service],
        dependencies: { service },
        init: async (_, { service }) => {
          expect(service).toBe("[INFO] SERVICE: Service initialized");
        },
      });

      await run(app);
    });

    it("should support dynamic configurations in resource dependencies", async () => {
      type ApiConfig = { baseUrl: string; timeout: number };

      const apiService = defineResource({
        id: "api.service",
        init: async (config: ApiConfig) => ({
          baseUrl: config.baseUrl,
          timeout: config.timeout,
          call: (endpoint: string) =>
            `${config.baseUrl}${endpoint} (timeout: ${config.timeout}ms)`,
        }),
      });

      const dynamicService = defineResource({
        id: "service.dynamic",
        register: () => [
          apiService.with({
            baseUrl: process.env.API_URL || "https://localhost:3000",
            timeout: parseInt(process.env.API_TIMEOUT || "5000"),
          }),
        ],
        dependencies: { apiService },
        init: async (_, { apiService }) => {
          return (apiService as any).call("/users");
        },
      });

      const app = defineResource({
        id: "app",
        register: [dynamicService],
        dependencies: { dynamicService },
        init: async (_, { dynamicService }) => {
          expect(dynamicService).toBe(
            "https://localhost:3000/users (timeout: 5000ms)",
          );
        },
      });

      await run(app);
    });
  });

  describe("Middleware Configurations in Dependencies", () => {
    it("should pass configurations to middleware in dependencies", async () => {
      type ValidationConfig = { schema: string; strict: boolean };

      const loggerResource = defineResource({
        id: "logger.validation",
        init: async () => ({
          log: (message: string) => `LOG: ${message}`,
        }),
      });

      const validationMiddleware = defineMiddleware({
        id: "middleware.validation",
        dependencies: {
          logger: loggerResource,
        },
        run: async ({ next }, { logger }, config: ValidationConfig) => {
          (logger as any).log(
            `Validating with schema: ${config.schema} (strict: ${config.strict})`,
          );
          const result = await next();
          return `Validated[${config.schema}]: ${result}`;
        },
      });

      const testTask = defineTask({
        id: "task.test",
        middleware: [
          validationMiddleware.with({ schema: "user", strict: true }),
        ],
        run: async () => "Task result",
      });

      const app = defineResource({
        id: "app",
        register: [loggerResource, validationMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask();
          expect(result).toBe("Validated[user]: Task result");
        },
      });

      await run(app);
    });

    it("should support dynamic middleware configurations", async () => {
      type RetryConfig = { maxAttempts: number; delay: number };

      const retryMiddleware = defineMiddleware({
        id: "middleware.retry",
        run: async ({ next }, _, config: RetryConfig) => {
          let attempts = 0;
          let lastError: Error | null = null;

          while (attempts < config.maxAttempts) {
            try {
              attempts++;
              const result = await next();
              return `Attempt ${attempts}/${config.maxAttempts}: ${result}`;
            } catch (error) {
              lastError = error as Error;
              if (attempts < config.maxAttempts) {
                // Simulate delay (in real scenario you'd use setTimeout)
                continue;
              }
            }
          }

          throw lastError;
        },
      });

      const retryableTask = defineTask({
        id: "task.retryable",
        middleware: [
          retryMiddleware.with({
            maxAttempts: parseInt(process.env.MAX_RETRIES || "3"),
            delay: parseInt(process.env.RETRY_DELAY || "1000"),
          }),
        ],
        run: async () => "Success",
      });

      const app = defineResource({
        id: "app",
        register: [retryMiddleware, retryableTask],
        dependencies: { retryableTask },
        init: async (_, { retryableTask }) => {
          const result = await retryableTask();
          expect(result).toBe("Attempt 1/3: Success");
        },
      });

      await run(app);
    });

    it("should support middleware with configured resource dependencies", async () => {
      type CacheConfig = { ttl: number; maxSize: number };
      type LoggerConfig = { level: string };

      const cache = defineResource({
        id: "cache",
        init: async (config: CacheConfig) => ({
          ttl: config.ttl,
          maxSize: config.maxSize,
          store: new Map(),
          get: (key: string) => `cached-${key}`,
          set: (key: string, value: any) => `stored-${key}:${value}`,
        }),
      });

      const logger = defineResource({
        id: "logger",
        init: async (config: LoggerConfig) => ({
          level: config.level,
          log: (message: string) => `[${config.level}] ${message}`,
        }),
      });

      const cachingMiddleware = defineMiddleware({
        id: "middleware.caching",
        dependencies: { cache, logger },
        run: async (
          { next },
          { cache, logger },
          config: { enabled: boolean },
        ) => {
          if (!config.enabled) {
            return next();
          }

          (logger as any).log(
            `Cache configured with TTL: ${(cache as any).ttl}, MaxSize: ${
              (cache as any).maxSize
            }`,
          );
          const result = await next();
          return `Cached: ${result}`;
        },
      });

      const cachedTask = defineTask({
        id: "task.cached",
        middleware: [cachingMiddleware.with({ enabled: true })],
        run: async () => "Task result",
      });

      const app = defineResource({
        id: "app",
        register: [
          cache.with({ ttl: 60000, maxSize: 100 }),
          logger.with({ level: "DEBUG" }),
          cachingMiddleware,
          cachedTask,
        ],
        dependencies: { cachedTask },
        init: async (_, { cachedTask }) => {
          const result = await cachedTask();
          expect(result).toBe("Cached: Task result");
        },
      });

      await run(app);
    });
  });

  describe("Combined Dynamic Register and Dependencies", () => {
    it("should support both dynamic register and dependencies together", async () => {
      type DatabaseConfig = { host: string };
      type CacheConfig = { ttl: number };

      const database = defineResource({
        id: "database",
        init: async (config: DatabaseConfig) => `DB: ${config.host}`,
      });

      const cache = defineResource({
        id: "cache",
        init: async (config: CacheConfig) => `Cache: ${config.ttl}ms`,
      });

      const service = defineResource({
        id: "service",
        register: () => [
          // Dynamic registration based on environment
          database.with({
            host: process.env.NODE_ENV === "test" ? "test-db" : "prod-db",
          }),
          cache.with({ ttl: process.env.NODE_ENV === "test" ? 1000 : 60000 }),
        ],
        dependencies: { database, cache },
        init: async (_, { database, cache }) =>
          `Service with ${database} and ${cache}`,
      });

      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";

      const app = defineResource({
        id: "app",
        register: [service],
        dependencies: { service },
        init: async (_, { service }) => {
          expect(service).toBe("Service with DB: test-db and Cache: 1000ms");
        },
      });

      await run(app);

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it("should handle complex conditional dependencies and registrations", async () => {
      const mockService = defineResource({
        id: "service.mock",
        init: async () => "Mock Service",
      });

      const realService = defineResource({
        id: "service.real",
        init: async () => "Real Service",
      });

      const featureToggle = defineResource({
        id: "feature.toggle",
        init: async () => ({
          isEnabled: (feature: string) =>
            process.env[`FEATURE_${feature}`] === "true",
        }),
      });

      // Set up environment for testing
      process.env.FEATURE_ADVANCED = "true";
      process.env.NODE_ENV = "development";

      const complexApp = defineResource({
        id: "app.complex",
        register: () => {
          const services: any[] = [featureToggle];

          // Add services based on feature flags and environment
          if (process.env.FEATURE_ADVANCED === "true") {
            services.push(realService);
          } else {
            services.push(mockService);
          }

          return services;
        },
        dependencies: () => {
          const deps: any = { featureToggle };

          // Same logic for dependencies
          if (process.env.FEATURE_ADVANCED === "true") {
            deps.service = realService;
          } else {
            deps.service = mockService;
          }

          return deps;
        },
        init: async (_, { service, featureToggle }) => {
          const isAdvanced = (featureToggle as any).isEnabled("ADVANCED");
          expect(isAdvanced).toBe(true);
          expect(service).toBe("Real Service");
          return `App with ${service}`;
        },
      });

      await run(complexApp);

      // Test with feature disabled
      process.env.FEATURE_ADVANCED = "false";

      const complexAppDisabled = defineResource({
        id: "app.complex.disabled",
        register: () => {
          const services: any[] = [featureToggle];

          if (process.env.FEATURE_ADVANCED === "true") {
            services.push(realService);
          } else {
            services.push(mockService);
          }

          return services;
        },
        dependencies: () => {
          const deps: any = { featureToggle };

          if (process.env.FEATURE_ADVANCED === "true") {
            deps.service = realService;
          } else {
            deps.service = mockService;
          }

          return deps;
        },
        init: async (_, { service, featureToggle }) => {
          const isAdvanced = (featureToggle as any).isEnabled("ADVANCED");
          expect(isAdvanced).toBe(false);
          expect(service).toBe("Mock Service");
          return `App with ${service}`;
        },
      });

      await run(complexAppDisabled);

      // Clean up environment
      delete process.env.FEATURE_ADVANCED;
    });
  });

  describe("Dynamic Dependencies and Register with Config", () => {
    it("should pass config to dependencies function in resource", async () => {
      const loggerService = defineResource({
        id: "service.logger",
        init: async (config: { level: string; prefix: string }) => ({
          log: (message: string) =>
            `[${config.level}] ${config.prefix}: ${message}`,
        }),
      });

      const cacheService = defineResource({
        id: "service.cache",
        init: async (config: { ttl: number; size: number }) => ({
          get: (key: string) => `cached-${key}-ttl:${config.ttl}`,
          set: (key: string, value: any) => `set-${key}-size:${config.size}`,
        }),
      });

      const dynamicService = defineResource({
        id: "service.dynamic",
        dependencies: (config: { useCache: boolean; logLevel: string }) => ({
          logger: loggerService,
          ...(config.useCache && { cache: cacheService }),
        }),
        init: async (config: { useCache: boolean; logLevel: string }, deps) => {
          const logger = deps.logger;
          const cache = config.useCache ? deps.cache : null;

          return {
            process: (data: string) => {
              const logResult = logger.log(`Processing ${data}`);
              const cacheResult = cache ? cache.get(data) : "no-cache";
              return `${logResult} | ${cacheResult}`;
            },
          };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          loggerService.with({ level: "DEBUG", prefix: "DYN" }),
          cacheService.with({ ttl: 3600, size: 100 }),
          dynamicService.with({ useCache: true, logLevel: "DEBUG" }),
        ],
        dependencies: { dynamicService },
        init: async (_, { dynamicService }) => {
          const result = dynamicService.process("test-data");
          expect(result).toBe(
            "[DEBUG] DYN: Processing test-data | cached-test-data-ttl:3600",
          );
        },
      });

      await run(app);
    });

    it("should pass config to register function in resource", async () => {
      const emailService = defineResource({
        id: "service.email",
        init: async (config: { provider: string; apiKey: string }) => ({
          send: (to: string, subject: string) =>
            `${config.provider}:${config.apiKey} -> ${to}: ${subject}`,
        }),
      });

      const smsService = defineResource({
        id: "service.sms",
        init: async (config: { provider: string; apiKey: string }) => ({
          send: (to: string, message: string) =>
            `${config.provider}:${config.apiKey} -> ${to}: ${message}`,
        }),
      });

      const notificationService = defineResource({
        id: "service.notification",
        register: (config: {
          enableEmail: boolean;
          enableSms: boolean;
          emailProvider: string;
          smsProvider: string;
        }) => [
          ...(config.enableEmail
            ? [
                emailService.with({
                  provider: config.emailProvider,
                  apiKey: "email-key",
                }),
              ]
            : []),
          ...(config.enableSms
            ? [
                smsService.with({
                  provider: config.smsProvider,
                  apiKey: "sms-key",
                }),
              ]
            : []),
        ],
        dependencies: (config: {
          enableEmail: boolean;
          enableSms: boolean;
          emailProvider: string;
          smsProvider: string;
        }) => ({
          ...(config.enableEmail && { emailService }),
          ...(config.enableSms && { smsService }),
        }),
        init: async (
          config: {
            enableEmail: boolean;
            enableSms: boolean;
            emailProvider: string;
            smsProvider: string;
          },
          deps: any,
        ) => ({
          notify: (type: string, recipient: string, content: string) => {
            if (type === "email" && config.enableEmail && deps.emailService) {
              return deps.emailService.send(recipient, content);
            }
            if (type === "sms" && config.enableSms && deps.smsService) {
              return deps.smsService.send(recipient, content);
            }
            return "notification-disabled";
          },
        }),
      });

      const app = defineResource({
        id: "app",
        register: [
          notificationService.with({
            enableEmail: true,
            enableSms: false,
            emailProvider: "sendgrid",
            smsProvider: "twilio",
          }),
        ],
        dependencies: { notificationService },
        init: async (_, { notificationService }) => {
          const emailResult = notificationService.notify(
            "email",
            "test@example.com",
            "Hello World",
          );
          const smsResult = notificationService.notify(
            "sms",
            "+1234567890",
            "Hello SMS",
          );

          expect(emailResult).toBe(
            "sendgrid:email-key -> test@example.com: Hello World",
          );
          expect(smsResult).toBe("notification-disabled");
        },
      });

      await run(app);
    });

    it("should pass config to middleware dependencies function", async () => {
      const auditService = defineResource({
        id: "service.audit",
        init: async (config: { enabled: boolean; level: string }) => ({
          log: (action: string, user: string) =>
            config.enabled
              ? `[${config.level}] ${user} performed ${action}`
              : "audit-disabled",
        }),
      });

      const authService = defineResource({
        id: "service.auth",
        init: async (config: { requireRole: string }) => ({
          validateRole: (userRole: string) => userRole === config.requireRole,
          getRequiredRole: () => config.requireRole,
        }),
      });

      const authMiddleware = defineMiddleware({
        id: "middleware.auth",
        dependencies: (config: {
          auditEnabled: boolean;
          requiredRole: string;
        }) => ({
          audit: auditService,
          auth: authService,
        }),
        run: async (
          { task, next },
          deps: any,
          config: { auditEnabled: boolean; requiredRole: string },
        ) => {
          const userRole = task?.input?.userRole || "guest";

          if (!deps.auth.validateRole(userRole)) {
            throw new Error(
              `Access denied. Required role: ${deps.auth.getRequiredRole()}`,
            );
          }

          const auditResult = deps.audit.log("protected-action", userRole);
          const result = await next(task?.input);

          return {
            result,
            audit: auditResult,
            validatedRole: userRole,
          };
        },
      });

      const protectedTask = defineTask({
        id: "task.protected",
        middleware: [
          authMiddleware.with({ auditEnabled: true, requiredRole: "admin" }),
        ],
        run: async (input: { userRole: string; data: string }) =>
          `Protected data: ${input.data}`,
      });

      const app = defineResource({
        id: "app",
        register: [
          auditService.with({ enabled: true, level: "INFO" }),
          authService.with({ requireRole: "admin" }),
          authMiddleware,
          protectedTask,
        ],
        dependencies: { protectedTask },
        init: async (_, { protectedTask }) => {
          const result = await protectedTask({
            userRole: "admin",
            data: "secret",
          });
          expect(result).toEqual({
            result: "Protected data: secret",
            audit: "[INFO] admin performed protected-action",
            validatedRole: "admin",
          });

          // Test access denied
          await expect(
            protectedTask({ userRole: "user", data: "secret" }),
          ).rejects.toThrow("Access denied. Required role: admin");
        },
      });

      await run(app);
    });

    it("should handle complex config-driven dependency resolution", async () => {
      const primaryDb = defineResource({
        id: "db.primary",
        init: async (config: { host: string; port: number }) => ({
          query: (sql: string) =>
            `primary-${config.host}:${config.port} -> ${sql}`,
        }),
      });

      const secondaryDb = defineResource({
        id: "db.secondary",
        init: async (config: { host: string; port: number }) => ({
          query: (sql: string) =>
            `secondary-${config.host}:${config.port} -> ${sql}`,
        }),
      });

      const cacheLayer = defineResource({
        id: "cache.layer",
        init: async (config: { redis: boolean; memory: boolean }) => ({
          get: (key: string) =>
            config.redis
              ? `redis-${key}`
              : config.memory
              ? `memory-${key}`
              : null,
          set: (key: string, value: any) => `cache-set-${key}`,
        }),
      });

      const complexService = defineResource({
        id: "service.complex",
        register: (config: {
          environment: "dev" | "prod";
          features: { caching: boolean; readReplica: boolean };
        }) => {
          const services: any[] = [
            primaryDb.with({
              host:
                config.environment === "prod" ? "prod-primary" : "dev-primary",
              port: config.environment === "prod" ? 5432 : 5433,
            }),
          ];

          if (config.features.readReplica) {
            services.push(
              secondaryDb.with({
                host:
                  config.environment === "prod"
                    ? "prod-secondary"
                    : "dev-secondary",
                port: config.environment === "prod" ? 5434 : 5435,
              }),
            );
          }

          if (config.features.caching) {
            services.push(
              cacheLayer.with({
                redis: config.environment === "prod",
                memory: config.environment === "dev",
              }),
            );
          }

          return services;
        },
        dependencies: (config: {
          environment: "dev" | "prod";
          features: { caching: boolean; readReplica: boolean };
        }) => ({
          primaryDb,
          ...(config.features.readReplica && { secondaryDb }),
          ...(config.features.caching && { cacheLayer }),
        }),
        init: async (
          config: {
            environment: "dev" | "prod";
            features: { caching: boolean; readReplica: boolean };
          },
          deps: any,
        ) => ({
          getData: (query: string, useCache: boolean = false) => {
            const cacheResult =
              useCache && deps.cacheLayer ? deps.cacheLayer.get(query) : null;
            if (cacheResult) return cacheResult;

            const dbResult =
              deps.secondaryDb && config.features.readReplica
                ? deps.secondaryDb.query(query)
                : deps.primaryDb.query(query);

            if (useCache && deps.cacheLayer) {
              deps.cacheLayer.set(query, dbResult);
            }

            return dbResult;
          },
        }),
      });

      const app = defineResource({
        id: "app",
        register: [
          complexService.with({
            environment: "prod",
            features: { caching: true, readReplica: true },
          }),
        ],
        dependencies: { complexService },
        init: async (_, { complexService }) => {
          const result1 = complexService.getData("SELECT * FROM users", false);
          const result2 = complexService.getData("SELECT * FROM posts", true);

          expect(result1).toBe(
            "secondary-prod-secondary:5434 -> SELECT * FROM users",
          );
          expect(result2).toBe("redis-SELECT * FROM posts");
        },
      });

      await run(app);
    });

    it("should support nested config-driven dependencies and registrations", async () => {
      const configService = defineResource({
        id: "service.config",
        init: async (baseConfig: { app: string; version: number }) => ({
          get: (key: string) =>
            `${baseConfig.app}-v${baseConfig.version}-${key}`,
          getApp: () => baseConfig.app,
          getVersion: () => baseConfig.version,
        }),
      });

      const metricsService = defineResource({
        id: "service.metrics",
        init: async (config: { enabled: boolean; endpoint: string }) => ({
          track: (event: string) =>
            config.enabled
              ? `metrics:${config.endpoint}/${event}`
              : "metrics-disabled",
        }),
      });

      const parentService = defineResource({
        id: "service.parent",
        register: (config: {
          appName: string;
          enableMetrics: boolean;
          metricsEndpoint: string;
        }) => [
          configService.with({ app: config.appName, version: 1 }),
          ...(config.enableMetrics
            ? [
                metricsService.with({
                  enabled: true,
                  endpoint: config.metricsEndpoint,
                }),
              ]
            : []),
        ],
        dependencies: (config: {
          appName: string;
          enableMetrics: boolean;
          metricsEndpoint: string;
        }) => ({
          configService,
          ...(config.enableMetrics && { metricsService }),
        }),
        init: async (
          config: {
            appName: string;
            enableMetrics: boolean;
            metricsEndpoint: string;
          },
          deps: any,
        ) => ({
          process: (action: string) => {
            const configResult = deps.configService.get(action);
            const metricsResult =
              config.enableMetrics && deps.metricsService
                ? deps.metricsService.track(action)
                : "no-metrics";
            return `${configResult} | ${metricsResult}`;
          },
        }),
      });

      const childService = defineResource({
        id: "service.child",
        dependencies: (config: {
          parentConfig: {
            appName: string;
            enableMetrics: boolean;
            metricsEndpoint: string;
          };
        }) => ({
          parent: parentService,
        }),
        init: async (
          config: {
            parentConfig: {
              appName: string;
              enableMetrics: boolean;
              metricsEndpoint: string;
            };
          },
          deps: any,
        ) => ({
          childProcess: (action: string) =>
            `child: ${deps.parent.process(action)}`,
        }),
      });

      const app = defineResource({
        id: "app",
        register: [
          parentService.with({
            appName: "MyApp",
            enableMetrics: true,
            metricsEndpoint: "http://metrics.example.com",
          }),
          childService.with({
            parentConfig: {
              appName: "MyApp",
              enableMetrics: true,
              metricsEndpoint: "http://metrics.example.com",
            },
          }),
        ],
        dependencies: { childService },
        init: async (_, { childService }) => {
          const result = childService.childProcess("user-login");
          expect(result).toBe(
            "child: MyApp-v1-user-login | metrics:http://metrics.example.com/user-login",
          );
        },
      });

      await run(app);
    });
  });
});
