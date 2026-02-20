## Testing

Runner's explicit dependency injection makes testing straightforward. Call `.run()` on a task with plain mocks for fast unit tests, or spin up the full runtime when you need middleware and lifecycle behavior.

### Two Testing Approaches

| Approach             | Speed  | What runs          | Best for                 |
| -------------------- | ------ | ------------------ | ------------------------ |
| **Unit test**        | Fast   | Just your function | Logic, edge cases        |
| **Integration test** | Slower | Full pipeline      | End-to-end flows, wiring |

### Unit Testing (Fast, Isolated)

Call `.run()` directly on any task with mock dependencies. This bypasses middleware and runtime — you're testing pure business logic.

```typescript
// Assuming: registerUser task is defined with { userService, userRegistered } dependencies
describe("registerUser task", () => {
  it("creates user and emits event", async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({
        id: "user-123",
        name: "Alice",
        email: "alice@example.com",
      }),
    };
    const mockUserRegistered = jest.fn().mockResolvedValue(undefined);

    // Call the task directly — no runtime needed
    const result = await registerUser.run(
      { name: "Alice", email: "alice@example.com" },
      { userService: mockUserService, userRegistered: mockUserRegistered },
    );

    expect(result.id).toBe("user-123");
    expect(mockUserRegistered).toHaveBeenCalledWith({
      userId: "user-123",
      email: "alice@example.com",
    });
  });

  it("propagates service errors", async () => {
    const mockUserService = {
      createUser: jest
        .fn()
        .mockRejectedValue(new Error("Email already exists")),
    };

    await expect(
      registerUser.run(
        { name: "Bob", email: "taken@example.com" },
        { userService: mockUserService, userRegistered: jest.fn() },
      ),
    ).rejects.toThrow("Email already exists");
  });
});
```

**What you just learned**: `.run(input, mocks)` gives you one-line unit tests — no runtime, no lifecycle, no middleware. Just your function and its dependencies.

### Integration Testing (Full Pipeline)

Use `run()` to start the full app with middleware, events, and lifecycle. Swap infrastructure with `override()`.

Important:
- `r.override(base, fn)` (or `override(base, patch)`) creates a replacement definition.
- `.overrides([...])` is what applies replacements in the running container.
- If you place both base and replacement in `.register([...])`, you'll get duplicate-id registration errors.

```typescript
import { run, r, override } from "@bluelibs/runner";

describe("User registration flow", () => {
  it("creates user, sends email, and tracks analytics", async () => {
    // Swap infrastructure with test doubles
    const testDb = r
      .resource("app.database")
      .init(async () => new InMemoryDatabase())
      .build();

    const mockMailer = override(realMailer, {
      init: async () => ({ send: jest.fn().mockResolvedValue(true) }),
    });

    const testApp = r
      .resource("test")
      .overrides([testDb, mockMailer])
      .register([...productionComponents])
      .build();

    const { runTask, getResourceValue, dispose } = await run(testApp);

    try {
      // Middleware, events, and hooks all fire
      const user = await runTask(registerUser, {
        name: "Charlie",
        email: "charlie@test.com",
      });

      expect(user.id).toBeDefined();

      const mailer = await getResourceValue(mockMailer);
      expect(mailer.send).toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
```

### Testing Tips

**Always dispose** — resources hold connections, timers, and listeners. Leaking them causes flaky tests.

```typescript
const { dispose } = await run(app);
try {
  // ... tests
} finally {
  await dispose();
}
```

**Prefer task references over string ids** — you get type-safe inputs and autocomplete:

```typescript
// Type-safe — autocomplete works
await runTask(registerUser, { name: "Alice", email: "alice@test.com" });

// Works but no type checking
await runTask("app.tasks.registerUser", {
  name: "Alice",
  email: "alice@test.com",
});
```

**Logs are suppressed** by default when `NODE_ENV=test`. Enable them for debugging:

```typescript
await run(app, { debug: "verbose" });
```

> **runtime:** "Testing: an elaborate puppet show where every string behaves. Then production walks in, kicks the stage, and asks for pagination. Still — nice coverage badge."
