---
name: runner-tester
description: Use when user mentions testing Runner code, writing tests, achieving 100% test coverage, debugging test failures, mocking dependencies, jest configuration, npm run coverage:ai, test-driven development with Runner, or asks 'how do I test X in Runner'
---

# Runner Tester Skill

Testing patterns for Runner framework - 100% coverage mandatory, no exceptions.

## Core Requirements

**CRITICAL:**
- 100% test coverage is MANDATORY
- NEVER ignore files to achieve coverage
- NEVER skip tests
- Use `npm run coverage:ai` for token-friendly reports
- Use `npm run test -- searchKey` for focused tests

## Basic Testing Pattern

```ts
import { r, run } from "@bluelibs/runner";

test("task with mocked dependencies", async () => {
  // 1. Create mocks
  const mockDb = {
    users: { create: jest.fn().mockResolvedValue({ id: "123", name: "Ada" }) }
  };

  // 2. Build app with mocks
  const db = r.resource("db").init(async () => mockDb).build();
  const createUser = r.task("createUser")
    .dependencies({ db })
    .run(async (input, { db }) => db.users.create(input))
    .build();

  const app = r.resource("test.app").register([db, createUser]).build();

  // 3. Run and assert
  const { runTask, dispose } = await run(app);
  const result = await runTask(createUser, { name: "Ada" });

  expect(result.name).toBe("Ada");
  expect(mockDb.users.create).toHaveBeenCalledWith({ name: "Ada" });

  // 4. Always dispose
  await dispose();
});
```

## Testing Resources

```ts
test("resource init and dispose", async () => {
  const cleanup = jest.fn();

  const db = r.resource("db")
    .init(async () => ({ connected: true, close: cleanup }))
    .dispose(async (value) => value.close())
    .build();

  const app = r.resource("test.app").register([db]).build();
  const { getResourceValue, dispose } = await run(app);

  const dbValue = await getResourceValue(db);
  expect(dbValue.connected).toBe(true);

  await dispose();
  expect(cleanup).toHaveBeenCalled();
});
```

## Testing Events & Hooks

```ts
test("event emission and hooks", async () => {
  const hookSpy = jest.fn();

  const userCreated = r.event("userCreated")
    .payloadSchema<{ userId: string }>({ parse: (v) => v })
    .build();

  const createUser = r.task("createUser")
    .dependencies({ userCreated })
    .run(async (input, { userCreated }) => {
      const user = { id: "123" };
      await userCreated({ userId: user.id });
      return user;
    })
    .build();

  const hook = r.hook("welcome")
    .on(userCreated)
    .run(async (event) => hookSpy(event.data.userId))
    .build();

  const app = r.resource("test.app").register([userCreated, createUser, hook]).build();
  const { runTask, dispose } = await run(app);

  await runTask(createUser, {});
  expect(hookSpy).toHaveBeenCalledWith("123");

  await dispose();
});
```

### Hook Execution Order

```ts
test("hooks respect order", async () => {
  const order: number[] = [];
  const event = r.event("test").build();

  const hook1 = r.hook("first").on(event).order(1)
    .run(async () => order.push(1)).build();

  const hook2 = r.hook("second").on(event).order(2)
    .run(async () => order.push(2)).build();

  const app = r.resource("test").register([event, hook1, hook2]).build();
  const { emitEvent, dispose } = await run(app);

  await emitEvent(event, {});
  expect(order).toEqual([1, 2]);

  await dispose();
});
```

### Stop Propagation

```ts
test("stopPropagation cancels downstream hooks", async () => {
  const hook2Spy = jest.fn();
  const event = r.event("test").build();

  const hook1 = r.hook("first").on(event).order(1)
    .run(async (evt) => evt.stopPropagation()).build();

  const hook2 = r.hook("second").on(event).order(2)
    .run(async () => hook2Spy()).build();

  const app = r.resource("test").register([event, hook1, hook2]).build();
  const { emitEvent, dispose } = await run(app);

  await emitEvent(event, {});
  expect(hook2Spy).not.toHaveBeenCalled();

  await dispose();
});
```

## Testing Middleware

```ts
test("middleware wraps task execution", async () => {
  const logs: string[] = [];

  const logger = r.resource("logger")
    .init(async () => ({ info: (msg: string) => logs.push(msg) }))
    .build();

  const loggingMiddleware = r.middleware.task("logging")
    .dependencies({ logger })
    .run(async ({ task, next }, { logger }) => {
      logger.info(`→ ${task.definition.id}`);
      const result = await next(task.input);
      logger.info(`← ${task.definition.id}`);
      return result;
    })
    .build();

  const testTask = r.task("test")
    .middleware([loggingMiddleware])
    .run(async () => "ok")
    .build();

  const app = r.resource("test").register([logger, loggingMiddleware, testTask]).build();
  const { runTask, dispose } = await run(app);

  await runTask(testTask);
  expect(logs).toEqual(["→ test", "← test"]);

  await dispose();
});
```

## Testing Async Context

```ts
test("async context provide and use", async () => {
  const requestContext = r.asyncContext<{ requestId: string }>("request").build();

  const getRequestId = r.task("getRequestId")
    .dependencies({ requestContext })
    .run(async (_, { requestContext }) => requestContext.use().requestId)
    .build();

  const app = r.resource("test").register([requestContext, getRequestId]).build();
  const { runTask, dispose } = await run(app);

  const result = await requestContext.provide(
    { requestId: "abc-123" },
    async () => runTask(getRequestId)
  );

  expect(result).toBe("abc-123");
  await dispose();
});

test("throws when context not provided", async () => {
  const requestContext = r.asyncContext<{ requestId: string }>("request").build();

  const getRequestId = r.task("getRequestId")
    .dependencies({ requestContext })
    .run(async (_, { requestContext }) => requestContext.use().requestId)
    .build();

  const app = r.resource("test").register([requestContext, getRequestId]).build();
  const { runTask, dispose } = await run(app);

  await expect(runTask(getRequestId)).rejects.toThrow();
  await dispose();
});
```

## Testing Optional Dependencies

```ts
test("optional dependency present", async () => {
  const analytics = r.resource("analytics")
    .init(async () => ({ track: jest.fn() }))
    .build();

  const task = r.task("task")
    .dependencies({ analytics: analytics.optional() })
    .run(async (input, { analytics }) => {
      if (analytics) analytics.track(input);
      return "ok";
    })
    .build();

  const app = r.resource("test").register([analytics, task]).build();
  const { runTask, getResourceValue, dispose } = await run(app);

  await runTask(task, { event: "test" });

  const analyticsValue = await getResourceValue(analytics);
  expect(analyticsValue.track).toHaveBeenCalledWith({ event: "test" });

  await dispose();
});

test("optional dependency absent", async () => {
  const analytics = r.resource("analytics")
    .init(async () => ({ track: jest.fn() }))
    .build();

  const task = r.task("task")
    .dependencies({ analytics: analytics.optional() })
    .run(async (input, { analytics }) => {
      if (analytics) analytics.track(input);
      return "ok";
    })
    .build();

  // Don't register analytics
  const app = r.resource("test").register([task]).build();
  const { runTask, dispose } = await run(app);

  const result = await runTask(task, { event: "test" });
  expect(result).toBe("ok");

  await dispose();
});
```

## Testing Errors

```ts
test("custom error handling", async () => {
  const AppError = r.error<{ code: number; message: string }>("AppError")
    .dataSchema({ parse: (v) => v })
    .build();

  const task = r.task("task")
    .run(async () => {
      AppError.throw({ code: 400, message: "Bad request" });
    })
    .build();

  const app = r.resource("test").register([task]).build();
  const { runTask, dispose } = await run(app);

  try {
    await runTask(task);
    fail("Should have thrown");
  } catch (err) {
    expect(AppError.is(err)).toBe(true);
    if (AppError.is(err)) {
      expect(err.data.code).toBe(400);
      expect(err.data.message).toBe("Bad request");
    }
  }

  await dispose();
});
```

## Testing Configuration

```ts
test("task configuration", async () => {
  const greet = r.task("greet")
    .configSchema<{ prefix: string }>({ parse: (v) => v })
    .run(async (name: string, _deps, config) => `${config.prefix} ${name}`)
    .build();

  const app = r.resource("test").register([greet.with({ prefix: "Hello" })]).build();
  const { runTask, dispose } = await run(app);

  const result = await runTask(greet, "World");
  expect(result).toBe("Hello World");

  await dispose();
});
```

## Coverage Best Practices

### Test All Branches

```ts
test("handles active user", async () => {
  const result = await runTask(processUser, { isActive: true });
  expect(result).toBe("active");
});

test("handles inactive user", async () => {
  const result = await runTask(processUser, { isActive: false });
  expect(result).toBe("inactive");
});
```

### Test Error Paths

```ts
test("handles database errors", async () => {
  const mockDb = {
    query: jest.fn().mockRejectedValue(new Error("Connection lost"))
  };

  await expect(runTask(task, input)).rejects.toThrow("Connection lost");
});
```

### Test Edge Cases

```ts
test("handles empty input", async () => {
  expect(await runTask(task, [])).toEqual([]);
});

test("handles null", async () => {
  expect(await runTask(task, null)).toBeNull();
});

test("handles large datasets", async () => {
  const large = Array(10000).fill(0).map((_, i) => i);
  const result = await runTask(task, large);
  expect(result).toHaveLength(10000);
});
```

## Common Mistakes

❌ **Forgetting dispose:**
```ts
const { runTask } = await run(app);
await runTask(task);
// Missing dispose!
```

✅ **Always dispose:**
```ts
const { runTask, dispose } = await run(app);
await runTask(task);
await dispose();
```

❌ **Ignoring coverage:**
```ts
// jest.config.js
coveragePathIgnorePatterns: ["hard-file.ts"]
```

✅ **Test everything:**
```ts
test("covers all paths", async () => { ... });
```

❌ **Real services:**
```ts
const db = r.resource("db").init(async () => new RealDB()).build();
```

✅ **Mocks:**
```ts
const db = r.resource("db").init(async () => mockDb).build();
```

## Debugging Tests

### Focused tests
```bash
npm run test -- taskName
```

### Verbose logging
```ts
const { runTask } = await run(app, { debug: "verbose" });
```

### Inspect state
```ts
const { getResourceValue } = await run(app);
console.log(await getResourceValue(db));
```

## Testing Checklist

Before committing:
- ✅ `npm run coverage:ai` shows 100%
- ✅ All tests pass
- ✅ All branches tested
- ✅ Error paths tested
- ✅ Edge cases covered
- ✅ Dispose called everywhere
- ✅ Mocks used (no real services)
- ✅ `npm run build` succeeds
- ✅ `npm run typecheck` passes

## Resources

- readmes/TESTING.md - Full testing guide
- Run `npm run coverage:ai` for coverage report
