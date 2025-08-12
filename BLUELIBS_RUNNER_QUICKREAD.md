# BlueLibs Runner - AI Quickread Guide

## Framework Overview
TypeScript-first framework with dependency injection. Four building blocks: Tasks, Resources, Events, Middleware.

## Core Philosophy
- **Tasks** = Functions with dependencies for business logic
- **Resources** = Singletons with init/dispose lifecycle  
- **Events** = Type-safe async communication
- **Explicit dependencies** = No magic, clear injections

## Entry Point
```typescript
import { resource, task, run } from "@bluelibs/runner";
const { dispose } = await run(mainResource);
```

## Four Core Building Blocks

### 1. Tasks
Functions with explicit dependencies for business logic.

```typescript
const sendEmail = task({
  dependencies: { emailService },
  run: async (emailData, { emailService }) => {
    return await emailService.send(emailData);
  },
});

// Testing
const result = await sendEmail.run(data, { emailService: mockService });
```

- Explicit dependency injection
- Direct testability via `.run()`  
- Built-in events: beforeRun, afterRun, onError

### 2. Resources
Singletons with init/dispose lifecycle.

```typescript
const database = resource({
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL);
    await client.connect();
    return client;
  },
  dispose: async (client) => client.close(),
});

// Configuration
const emailer = resource({
  init: async (config: { smtpUrl: string }) => new EmailService(config.smtpUrl),
});
// Usage: emailer.with({ smtpUrl: "smtp://localhost" })
```

- Automatic lifecycle management
- Type-safe configuration via `.with(config)`
- Dependency injection between resources

### 3. Events
Type-safe async communication.

```typescript
const userRegistered = event<{ userId: string }>({ id: "user.registered" });

// Emit
await userRegistered({ userId: "123" });

// Listen
const sendWelcome = task({
  on: userRegistered,
  listenerOrder: -100, // Priority (lower = first)
  run: async (eventData) => {
    // eventData is type-safe: { userId: string }
    eventData.stopPropagation(); // Prevent other listeners
  },
});
```

- Type-safe event data
- Listener priority via `listenerOrder`
- Wildcard listeners (`on: "*"`)
- Built-in framework events: `globals.tasks.*`, `globals.resources.*`

### 4. Middleware
Interceptors for cross-cutting concerns.

```typescript
const authMiddleware = middleware({
  run: async ({ task, next }, deps, config: { requiredRole: string }) => {
    if (task.input.user.role !== config.requiredRole) {
      throw new Error("Unauthorized");
    }
    return next(task.input);
  },
});

// Usage
const adminTask = task({
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async (input) => "Secret data",
});
```

- Configuration via `.with(config)`
- Global application via `.everywhere()`
- Can modify input/output or prevent execution

## Advanced Features

### Context System
Request-scoped data without prop drilling.

```typescript
const UserContext = createContext<{ userId: string }>("user");

const task = task({
  middleware: [UserContext.require()],
  run: async () => {
    const user = UserContext.use(); // Available anywhere
    return user.userId;
  },
});

// Provide context
UserContext.provide({ userId: "123" }, async () => {
  return await task();
});
```

### Built-in Utilities

```typescript
// Advanced caching with custom cache factory
const cached = task({
  middleware: [globals.middleware.cache.with({ 
    ttl: 60000,
    keyBuilder: (taskId, input) => `${taskId}-${input.userId}-${input.type}`
  })],
  run: async (input) => expensiveOperation(input),
});

// Override default LRU cache with Redis
const redisCacheFactory = task({
  id: "globals.tasks.cacheFactory", // Override default
  dependencies: { redis: redisClient },
  run: async (options, { redis }) => new RedisCache(redis, options),
});

// Retry with sophisticated strategies
const retry = task({
  middleware: [globals.middleware.retry.with({ 
    retries: 5,
    delayStrategy: (attempt) => 100 * Math.pow(2, attempt), // Exponential backoff
    stopRetryIf: (error) => error.status === 401 // Don't retry auth errors
  })],
  run: async () => unreliableService(),
});

// Advanced logging with event-driven handlers
const logger = globals.resources.logger;
logger.info("Message", { data: { userId: "123" } });
logger.setPrintThreshold("info");

// Ship logs to external services
const logShipper = task({
  on: globals.events.log,
  run: async (event) => {
    const log = event.data;
    if (log.level === "critical") {
      await pagerDuty.alert({ message: log.message, context: log.context });
    }
    await logWarehouse.ship(log);
  },
});

// Context-aware logging
const requestLogger = logger.with({ 
  requestId: "req-123", 
  source: "api.handler",
  userId: "user-456" 
});
```

### Concurrency Control & Monitoring

```typescript
// Semaphore with comprehensive monitoring
const dbSemaphore = new Semaphore(5);

// Usage with metrics
const result = await dbSemaphore.withPermit(async () => {
  return db.query("SELECT * FROM users");
}, { timeout: 5000 });

// Monitor semaphore health
const metrics = dbSemaphore.getMetrics();
console.log(`Available: ${metrics.availablePermits}/${metrics.maxPermits}`);
console.log(`Waiting: ${metrics.waitingCount}`);
console.log(`Utilization: ${(metrics.utilization * 100).toFixed(1)}%`);

// Queue with deadlock detection and cancellation
const queue = new Queue();
const result = await queue.run(async (signal) => {
  // Check for cancellation periodically
  signal.throwIfAborted();
  return longRunningOperation();
});

// Graceful shutdown with cancellation
await queue.dispose({ cancel: true });

// Production monitoring pattern
const monitoringTask = task({
  id: "monitoring.concurrency",
  on: globals.tasks.beforeRun,
  run: async (event) => {
    if (event.source.includes("database")) {
      const metrics = dbSemaphore.getMetrics();
      if (metrics.waitingCount > 5) {
        await alerting.warn("Database semaphore backlog", { metrics });
      }
    }
  },
});
```

### Meta Tags & Behavioral Control

```typescript
import { tag } from "@bluelibs/runner";

// Define structured tags with configuration
const performanceTag = tag<{ alertAboveMs: number }>({ id: "performance.monitoring" });
const environmentTag = tag<{ env: "dev" | "staging" | "prod" }>({ id: "environment" });
const costTag = tag<{ tier: "free" | "paid"; creditsPerCall: number }>({ id: "cost.tracking" });

// Advanced tag usage patterns
const expensiveTask = task({
  meta: {
    title: "AI Data Processing",
    tags: [
      "computation", // String tag for simple classification
      performanceTag.with({ alertAboveMs: 5000 }), // Performance monitoring
      environmentTag.with({ env: "prod" }), // Environment-specific behavior
      costTag.with({ tier: "paid", creditsPerCall: 10 }) // Cost tracking
    ]
  },
  run: async (input) => heavyComputation(input),
});

// Environment-aware middleware
const envMiddleware = middleware({
  run: async ({ task, next }) => {
    const envConfig = environmentTag.extract(task.definition.meta?.tags);
    if (envConfig?.config.env === "dev") {
      console.log(`[DEV] Running ${task.definition.id}`);
      return next(task.input);
    }
    return next(task.input);
  },
});

// Cost tracking middleware
const costTracker = middleware({
  dependencies: { billing: billingService },
  run: async ({ task, next }, { billing }) => {
    const costConfig = costTag.extract(task.definition.meta?.tags);
    if (costConfig) {
      await billing.deductCredits(costConfig.config.creditsPerCall);
    }
    return next(task.input);
  },
});

// Tag-based component discovery
function getProductionTasks(store) {
  return store.getAllTasks().filter(task => {
    const envConfig = environmentTag.extract(task.meta?.tags);
    return envConfig?.config.env === "prod";
  });
}

// Apply middleware only to tagged components
const app = resource({
  register: [
    // Apply cost tracking only to paid features
    costTracker.everywhere({ 
      tasks: (task) => costTag.extract(task.meta?.tags) !== null 
    }),
    // Apply environment middleware globally
    envMiddleware.everywhere({ tasks: true })
  ]
});

// Custom metadata extensions
declare module "@bluelibs/runner" {
  interface ITaskMeta {
    owner?: string;
    version?: string;
    deprecated?: boolean;
    healthCheck?: string;
  }
}

const healthCheckTask = task({
  meta: {
    owner: "platform-team",
    version: "2.1.0",
    healthCheck: "/health/ai-service",
    tags: ["health", "monitoring"]
  },
  run: async () => ({ status: "healthy", version: "2.1.0" }),
});
```

## Common Patterns

### Factory Pattern
```typescript
// Create instances dynamically
const connectionFactory = resource({
  init: async (config: { poolSize: number }) => {
    return (connectionString: string) => {
      return new DatabaseConnection(connectionString, config);
    };
  },
});

const app = resource({
  register: [connectionFactory.with({ poolSize: 10 })],
  dependencies: { connectionFactory },
  init: async (_, { connectionFactory }) => {
    const conn = connectionFactory("postgresql://...");
  },
});
```

### Tag-Based Component Selection
```typescript
// Find components by tags
function getApiTasks(store) {
  return store.getAllTasks().filter(task => 
    task.meta?.tags?.includes("api")
  );
}

// Apply middleware based on tags
const taggedMiddleware = middleware({
  run: async ({ task, next }) => {
    const isDestructive = task.definition.meta?.tags?.includes("destructive");
    if (isDestructive) {
      await auditLogger.log({ operation: task.definition.id });
    }
    return next(task.input);
  },
});
```

### Conditional Dependencies
```typescript
// Static (most common)
const service = resource({
  dependencies: { database },
  init: async (_, { database }) => { /* ... */ }
});

// Dynamic (conditional/circular)  
const service = resource({
  dependencies: (config) => ({ 
    db: config.useCache ? cachedDb : directDb 
  }),
  register: (config) => [
    config.useCache ? cachedDb : directDb
  ]
});

// Circular types - use explicit typing
const resource = defineResource({...}) as IResource<Config, ReturnType>;
```

### Organization Patterns
```typescript
// Group related dependencies
const services = index({ userService, emailService, paymentService });

// Layered architecture
const dataLayer = index({ database, userRepo, orderRepo });
const businessLayer = index({ userService, orderService, paymentService });
const apiLayer = index({ userController, orderController });

const app = resource({
  register: [
    dataLayer,
    businessLayer, 
    apiLayer,
    authMiddleware.everywhere({ tasks: true })
  ],
  dependencies: { api: apiLayer },
  init: async (_, { api }) => createExpressApp(api)
});
```

### Override Patterns
```typescript
// Simple override
const mockService = override(productionService, {
  init: async () => new MockService()
});

// Environment-specific overrides
const getEmailService = () => {
  return process.env.NODE_ENV === "test" 
    ? override(emailService, { init: async () => new MockEmailer() })
    : emailService;
};

// Testing with multiple overrides
const testApp = resource({
  register: [productionApp],
  overrides: [
    override(database, { init: async () => new InMemoryDB() }),
    override(emailService, { init: async () => new MockEmailer() }),
    override(paymentService, { init: async () => new FakePayments() })
  ]
});
```

## Testing Strategies

### Unit Testing
```typescript
// Direct task testing with mocks
const mockEmailService = { send: jest.fn().mockResolvedValue({ id: "sent" }) };
const mockLogger = { info: jest.fn(), error: jest.fn() };

const result = await sendEmail.run(
  { to: "test@example.com", subject: "Hello" },
  { emailService: mockEmailService, logger: mockLogger }
);

expect(mockEmailService.send).toHaveBeenCalledWith({
  to: "test@example.com", 
  subject: "Hello"
});
expect(result.id).toBe("sent");
```

### Integration Testing with Test Harness
```typescript
import { createTestResource } from "@bluelibs/runner";

describe("User registration flow", () => {
  let harness, dispose;
  
  beforeEach(async () => {
    const testApp = createTestResource(productionApp, { 
      overrides: [
        override(database, { init: async () => new InMemoryDB() }),
        override(emailService, { init: async () => new MockEmailer() })
      ]
    });
    
    const result = await run(testApp);
    harness = result.value;
    dispose = result.dispose;
  });
  
  afterEach(async () => {
    await dispose();
  });
  
  it("should register user and send welcome email", async () => {
    const userData = { name: "John", email: "john@example.com" };
    const user = await harness.runTask(registerUser, userData);
    
    expect(user.name).toBe("John");
    expect(user.id).toBeDefined();
    
    // Verify event was emitted by checking side effects
    // (email sending would be verified through the mock)
  });
});
```

### Testing Event Flows
```typescript
describe("Event-driven workflows", () => {
  it("should handle user registration events", async () => {
    const eventSpy = jest.fn();
    
    const testWelcomeTask = task({
      on: userRegistered,
      run: eventSpy
    });
    
    const testApp = createTestResource(app, {
      overrides: [
        // Add the spy task to capture events
        override(sendWelcomeEmail, testWelcomeTask)
      ]
    });
    
    const { value: harness, dispose } = await run(testApp);
    
    await harness.runTask(registerUser, { name: "Test" });
    
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: expect.any(String) }
      })
    );
    
    await dispose();
  });
});
```

### Testing Middleware
```typescript
describe("Auth middleware", () => {
  it("should reject unauthorized requests", async () => {
    const unauthorizedTask = task({
      middleware: [authMiddleware.with({ requiredRole: "admin" })],
      run: async () => "secret data"
    });
    
    // Test with invalid context
    await expect(
      UserContext.provide({ role: "user" }, async () => {
        return unauthorizedTask.run({}, {});
      })
    ).rejects.toThrow("Unauthorized");
    
    // Test with valid context
    const result = await UserContext.provide({ role: "admin" }, async () => {
      return unauthorizedTask.run({}, {});
    });
    
    expect(result).toBe("secret data");
  });
});
```

### Scenario Testing Patterns
```typescript
describe("E2E User Journey", () => {
  it("should complete full user onboarding", async () => {
    const scenario = createTestResource(
      resource({
        register: [userService, emailService, notificationService],
        dependencies: { userService, emailService, notificationService },
        init: async (_, services) => services
      }),
      { overrides: [inMemoryDatabase] }
    );
    
    const { value: services, dispose } = await run(scenario);
    
    // Step 1: Register user
    const user = await services.userService.create({ email: "test@example.com" });
    
    // Step 2: Verify email was queued
    expect(await services.emailService.getQueuedEmails()).toHaveLength(1);
    
    // Step 3: Process email queue
    await services.emailService.processQueue();
    
    // Step 4: Check notifications
    const notifications = await services.notificationService.getForUser(user.id);
    expect(notifications).toContainEqual(
      expect.objectContaining({ type: "welcome" })
    );
    
    await dispose();
  });
});
```

### Testing Best Practices
- **Unit tests**: Direct `.run()` calls with mocks
- **Integration tests**: Use `createTestResource()` with overrides
- **Event testing**: Override event handlers with spies
- **Middleware testing**: Test in isolation with context
- **Scenario testing**: Chain multiple operations with test harness
- **Always dispose**: Prevent resource leaks in tests
- **Use in-memory alternatives**: Fast, isolated test environment

## IDs & Conventions

### Anonymous IDs
Framework auto-generates IDs from file paths when omitted:
```typescript
// In src/services/email.ts - gets Symbol('services.email.resource')
const emailService = resource({ init: async () => new EmailService() });
```

### Manual ID Patterns
- Tasks: `domain.tasks.taskName`
- Resources: `domain.resources.resourceName` 
- Events: `domain.events.eventName`
- Middleware: `domain.middleware.middlewareName`

**Use Manual IDs for:** Events (listeners need predictable names), Public APIs, Middleware
**Use Anonymous IDs for:** Internal tasks, Configuration resources, Test mocks

## Error Handling & Production Patterns

```typescript
// Advanced error handling with classification
const errorHandler = task({
  on: riskyTask.events.onError,
  run: async (event) => {
    const error = event.data.error;
    
    // Classify and handle different error types
    if (error.name === "ValidationError") {
      await logger.warn("Validation failed", { error, input: event.data.input });
      event.data.suppress(); // Don't bubble up validation errors
    } else if (error.code === "ECONNREFUSED") {
      await logger.error("Service unavailable", { error, service: "database" });
      // Let it bubble up for retry logic
    } else {
      await alerting.critical("Unexpected error", { error, taskId: event.source });
    }
  },
});

// Circuit breaker pattern using error events
const circuitBreaker = resource({
  init: async () => ({ failures: 0, lastFailure: null, isOpen: false }),
});

const circuitBreakerMiddleware = middleware({
  dependencies: { breaker: circuitBreaker },
  run: async ({ task, next }, { breaker }) => {
    if (breaker.isOpen && Date.now() - breaker.lastFailure < 30000) {
      throw new Error("Circuit breaker is open");
    }
    
    try {
      const result = await next(task.input);
      breaker.failures = 0; // Reset on success
      breaker.isOpen = false;
      return result;
    } catch (error) {
      breaker.failures++;
      breaker.lastFailure = Date.now();
      if (breaker.failures >= 5) {
        breaker.isOpen = true;
        await logger.error("Circuit breaker opened", { failures: breaker.failures });
      }
      throw error;
    }
  },
});

// Health check patterns
const healthChecker = task({
  id: "app.health.check",
  dependencies: { database, redis, apiService },
  run: async (_, { database, redis, apiService }) => {
    const checks = await Promise.allSettled([
      database.ping().then(() => ({ service: "database", status: "healthy" })),
      redis.ping().then(() => ({ service: "redis", status: "healthy" })),
      apiService.health().then(() => ({ service: "api", status: "healthy" }))
    ]);
    
    return {
      overall: checks.every(c => c.status === "fulfilled") ? "healthy" : "degraded",
      services: checks.map(c => 
        c.status === "fulfilled" ? c.value : { 
          service: "unknown", 
          status: "unhealthy", 
          error: c.reason.message 
        }
      )
    };
  },
});

// Graceful shutdown with timeout
const { dispose } = await run(app);
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  const timeout = setTimeout(() => {
    console.log("Shutdown timeout, forcing exit");
    process.exit(1);
  }, 10000); // 10 second timeout
  
  try {
    await dispose();
    clearTimeout(timeout);
    console.log("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});
```

## Complete Example
```typescript
import { resource, task, event, index, run, createContext } from "@bluelibs/runner";

// Context & Events
const UserContext = createContext<{ userId: string }>("user");
const userRegistered = event<{ userId: string }>({ id: "user.registered" });

// Resources
const database = resource({
  init: async () => new MongoClient(process.env.DATABASE_URL!),
  dispose: async (client) => client.close(),
});

const userService = resource({
  dependencies: { database },
  init: async (_, { database }) => ({
    createUser: async (data) => database.collection("users").insertOne(data)
  })
});

// Tasks
const registerUser = task({
  dependencies: { userService, userRegistered },
  middleware: [UserContext.require()],
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);
    await userRegistered({ userId: user.id });
    return user;
  },
});

// Event Handler  
const sendWelcome = task({
  on: userRegistered,
  run: async (event) => console.log(`Welcome ${event.data.userId}`)
});

// App
const services = index({ userService, registerUser });
const app = resource({
  register: [database, services, sendWelcome],
  dependencies: { services },
  init: async (_, { services }) => {
    const express = require("express");
    const server = express();
    
    server.post("/register", async (req, res) => {
      await UserContext.provide({ userId: req.user?.id }, async () => {
        const user = await services.registerUser(req.body);
        res.json(user);
      });
    });
    
    return server.listen(3000);
  },
  dispose: async (server) => server.close(),
});

const { dispose } = await run(app);
```

**Key Features:**
- Explicit dependencies with type safety
- Event-driven architecture  
- Built-in lifecycle management
- Context system for request-scoped data
- Middleware for cross-cutting concerns
- Built-in utilities (caching, retry, logging, concurrency)
- Excellent testability and developer experience