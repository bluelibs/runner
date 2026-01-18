## Testing

Runner's explicit dependency injection makes testing straightforward—no magic mocks, no container hacks. Just pass what you need.

### Two testing approaches

| Approach             | Speed  | What runs      | Best for          |
| -------------------- | ------ | -------------- | ----------------- |
| **Unit test**        | Fast   | Just your code | Logic, edge cases |
| **Integration test** | Slower | Full pipeline  | End-to-end flows  |

### Unit testing (fast, isolated)

Call `.run()` directly on any task with mock dependencies. This **bypasses middleware**—you're testing pure business logic.

```typescript
import { describe, it, expect, vi } from "vitest";

describe("registerUser task", () => {
  it("creates user and emits event", async () => {
    // Create mocks
    const mockDb = {
      createUser: vi.fn().mockResolvedValue({ id: "user-123", name: "Alice" }),
    };
    const mockEvent = vi.fn();

    // Call the task directly - no runtime needed!
    const result = await registerUser.run(
      { name: "Alice", email: "alice@example.com" },
      { database: mockDb, userCreated: mockEvent }, // Inject mocks
    );

    // Assert
    expect(result.id).toBe("user-123");
    expect(mockEvent).toHaveBeenCalledWith({
      userId: "user-123",
      email: "alice@example.com",
    });
  });

  it("handles duplicate email", async () => {
    const mockDb = {
      createUser: vi.fn().mockRejectedValue(new Error("Email already exists")),
    };

    await expect(
      registerUser.run(
        { name: "Bob", email: "taken@example.com" },
        { database: mockDb },
      ),
    ).rejects.toThrow("Email already exists");
  });
});
```

### Integration testing (full pipeline)

Spin up the entire app with real middleware, events, and lifecycle. Use `override()` to swap out infrastructure.

```typescript
import { run, r, override } from "@bluelibs/runner";

describe("User registration flow", () => {
  it("creates user, sends email, and tracks analytics", async () => {
    // Create test doubles for infrastructure
    const testDb = r
      .resource("app.database")
      .init(async () => new InMemoryDatabase())
      .build();

    const mockMailer = override(realMailer, {
      init: async () => ({ send: vi.fn().mockResolvedValue(true) }),
    });

    // Build test harness with overrides
    const testApp = r
      .resource("test")
      .overrides([testDb, mockMailer])
      .register([...productionComponents])
      .build();

    // Run the full app
    const { runTask, getResourceValue, dispose } = await run(testApp);

    try {
      // Execute through the full pipeline (middleware runs!)
      const user = await runTask(registerUser, {
        name: "Charlie",
        email: "charlie@test.com",
      });

      // Verify
      expect(user.id).toBeDefined();

      const mailer = await getResourceValue(mockMailer);
      expect(mailer.send).toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
```

### Testing tips

**Logs are suppressed in tests** by default (when `NODE_ENV=test`). To see them:

```typescript
await run(app, { debug: "verbose" });
```

**Use task references for type safety:**

```typescript
// Type-safe - autocomplete works
await runTask(registerUser, { name: "Alice", email: "alice@test.com" });

// Works but no type checking
await runTask("app.tasks.registerUser", {
  name: "Alice",
  email: "alice@test.com",
});
```

**Always dispose:**

```typescript
const { dispose } = await run(app);
try {
  // ... tests
} finally {
  await dispose(); // Clean up connections, timers, etc.
}
```

> **runtime:** "Testing: an elaborate puppet show where every string behaves. Then production walks in, kicks the stage, and asks for pagination. Still—nice coverage badge."
