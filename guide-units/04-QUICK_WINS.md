## Quick Wins: Copy-Paste Solutions

Production-ready patterns you can use today. Each example is complete and tested.

| Problem                  | Solution                  | Jump to                                                         |
| ------------------------ | ------------------------- | --------------------------------------------------------------- |
| Expensive repeated calls | Add caching               | [Caching](#add-caching-to-any-task-with-automatic-invalidation) |
| Flaky external APIs      | Auto-retry with backoff   | [Retry](#retry-failed-api-calls-with-exponential-backoff)       |
| Hanging operations       | Add timeouts              | [Timeouts](#add-request-timeouts-prevent-hanging-operations)    |
| Tight coupling           | Event-driven architecture | [Events](#set-up-event-driven-architecture-in-30-seconds)       |
| Race conditions          | Sequential queue          | [Queue](#prevent-race-conditions-per-process-queue)             |
| Production debugging     | Structured logging        | [Logging](#add-structured-logging-with-context)                 |

---

### Add Caching to Any Task (with automatic invalidation)

```typescript
import { r, globals } from "@bluelibs/runner";

const getUser = r
  .task("users.get")
  .middleware([
    globals.middleware.task.cache.with({
      ttl: 60 * 1000, // 1 minute
      keyBuilder: (taskId, input) => `user:${input.id}`,
    }),
  ])
  .run(async (input: { id: string }) => {
    return await db.users.findOne({ id: input.id });
  })
  .build();

// First call: hits database
// Next 60 seconds: instant from cache
// After 60s: refreshes automatically
```

### Retry Failed API Calls (with exponential backoff)

```typescript
const callExternalAPI = r
  .task("api.external")
  .middleware([
    globals.middleware.task.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 100 * Math.pow(2, attempt), // 100ms, 200ms, 400ms
      stopRetryIf: (error) => error.status === 404, // Don't retry not found
    }),
  ])
  .run(async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .build();

// Automatically retries transient failures
// Gives up on permanent errors
```

### Add Request Timeouts (prevent hanging operations)

```typescript
const slowOperation = r
  .task("operations.slow")
  .middleware([
    globals.middleware.task.timeout.with({ ttl: 5000 }), // 5 second max
  ])
  .run(async () => {
    // This will throw TimeoutError if it takes > 5s
    return await someSlowDatabaseQuery();
  })
  .build();

// Combine with retry for robust error handling
const robustTask = r
  .task("operations.robust")
  .middleware([
    globals.middleware.task.retry.with({ retries: 3 }),
    globals.middleware.task.timeout.with({ ttl: 10000 }), // Each retry gets 10s
  ])
  .run(async () => await unreliableOperation())
  .build();
```

### Set Up Event-Driven Architecture (in 30 seconds)

```typescript
// Define your events
const userRegistered = r
  .event("users.registered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Emit events from tasks
const registerUser = r
  .task("users.register")
  .dependencies({ userRegistered })
  .run(async (input, { userRegistered }) => {
    const user = await createUserInDB(input);
    await userRegistered({ userId: user.id, email: user.email }); //  Emit!
    return user;
  })
  .build();

// React to events with hooks
const sendWelcomeEmail = r
  .hook("users.welcome")
  .on(userRegistered)
  .run(async (event) => {
    await emailService.send({
      to: event.data.email,
      subject: "Welcome!",
      body: "Thanks for joining!",
    });
  })
  .build();

// Automatically decoupled - no direct dependencies!
// Note: createUserInDB and emailService are your own implementations
```

### Prevent Race Conditions (per-process queue)

The built-in queue provides in-process named locks - no Redis needed, but only works within a single Node.js process.

```typescript
const writeConfig = r
  .task("config.write")
  .dependencies({ queue: globals.resources.queue })
  .run(async (input: { key: string; value: string }, { queue }) => {
    // Only one write per key at a time within this process
    return await queue.run(`config:${input.key}`, async () => {
      await fs.writeFile(
        `/config/${input.key}.json`,
        JSON.stringify(input.value),
      );
      return { written: true };
    });
  })
  .build();

// Same key? Queued. Different keys? Parallel.
```

### Add Structured Logging (with context)

```typescript
const processPayment = r
  .task("payments.process")
  .dependencies({ logger: globals.resources.logger })
  .run(async (input: { orderId: string; amount: number }, { logger }) => {
    // Logs are automatically structured and include task context
    await logger.info("Processing payment", {
      data: { orderId: input.orderId, amount: input.amount },
    });

    try {
      const result = await chargeCard(input);
      await logger.info("Payment successful", {
        data: { transactionId: result.id },
      });
      return result;
    } catch (error) {
      await logger.error("Payment failed", {
        error,
        data: { orderId: input.orderId, amount: input.amount },
      });
      throw error;
    }
  })
  .build();

// Logs include: timestamp, level, source (task ID), data, errors
// Perfect for production debugging!
```

### Wire It All Together

```typescript
import { r, run } from "@bluelibs/runner";

// After defining your tasks, events, and hooks...
const app = r
  .resource("app")
  .register([
    getUser, // cached task
    callExternalAPI, // retrying task
    registerUser, // event emitter
    userRegistered, // event definition
    sendWelcomeEmail, // hook listener
    processOrder, // queue-protected task
    processPayment, // logged task
  ])
  .build();

// Start the runtime
const { runTask, dispose } = await run(app);

// Execute tasks
const user = await runTask(getUser, { id: "123" });
const result = await runTask(registerUser, { email: "new@user.com" });

// Shutdown gracefully when done
await dispose();
```

**That's it!** Each pattern is production-ready. No configuration, no extra packages, just works.

> **runtime:** "Six production problems, six one-liners. You bolted middleware onto tasks like Lego bricks and called it architecture. I respect the pragmatism. Ship it."

---
