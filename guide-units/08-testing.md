## Testing

Runner's explicit dependency graph makes testing flexible. You can test one task like a normal function, boot a focused subtree, or run the full application pipeline.

### Three Testing Approaches

| Approach                | Speed    | What runs                | What it skips                                  | Best for                     |
| ----------------------- | -------- | ------------------------ | ---------------------------------------------- | ---------------------------- |
| **Unit test**           | Fast     | Just your task function  | Runtime wiring, validation, middleware, hooks  | Logic, edge cases            |
| **Focused Integration** | Moderate | Subtree + real runtime   | Unrelated modules you did not register         | Feature modules in isolation |
| **Full Integration**    | Slower   | Full runtime pipeline    | Nothing intentional                            | End-to-end flows, wiring     |

### Unit Testing (Fast, Isolated)

Call `.run()` directly on a task with mock dependencies when you want pure business logic tests.

```typescript
describe("registerUser task", () => {
  it("creates a user and emits an event", async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({
        id: "user-123",
        name: "Alice",
        email: "alice@example.com",
      }),
    };
    const mockUserRegistered = jest.fn().mockResolvedValue(undefined);

    const result = await registerUser.run(
      { name: "Alice", email: "alice@example.com" },
      {
        userService: mockUserService,
        userRegistered: mockUserRegistered,
      },
    );

    expect(result.id).toBe("user-123");
    expect(mockUserRegistered).toHaveBeenCalledWith({
      userId: "user-123",
      email: "alice@example.com",
    });
  });
});
```

Important boundary:

- `.run(input, mocks)` exercises your task body only
- it does **not** run middleware, runtime validation, lifecycle hooks, execution context propagation, or health-gated admission rules

Use this path when that omission is exactly what you want.

### Focused Integration Testing (Moderate, Subtree Only)

You do not need to boot the whole application to test one feature module. Build a small harness resource, register the subtree you care about, and override the external dependencies around it.

```typescript
import { run, r } from "@bluelibs/runner";
import {
  notificationsResource,
  processNotificationQueue,
} from "./notifications";
import { emailResource } from "./email";

describe("Notifications module", () => {
  it("processes notifications correctly", async () => {
    const mockEmailProvider = r.override(emailResource, async () => ({
      send: jest.fn().mockResolvedValue(true),
    }));

    const testHarness = r
      .resource("testHarness")
      .register([
        notificationsResource,
        emailResource,
      ])
      .overrides([mockEmailProvider])
      .build();

    const { runTask, dispose } = await run(testHarness, {
      mode: "test",
      logs: { printThreshold: null },
    });

    try {
      await runTask(processNotificationQueue, { batchId: "123" });
      // assertions...
    } finally {
      await dispose();
    }
  });
});
```

Ownership rule:

- an override only works if the target definition is actually registered in the harness graph
- the override must be declared by the same owning resource or one of its ancestors

> **Note:** You do not need to pass `mode: "test"` explicitly when your test runner already sets `NODE_ENV=test`. Runner auto-detects `test` mode from the environment unless you override `mode` yourself.

When multiple overrides target the same definition in resolved `test` mode, the outermost declaring resource wins.

### Full Integration Testing (Full Pipeline)

Use `run()` against the full app graph when you want the real middleware, hooks, validation, lifecycle, and dependency wiring.

```typescript
import { run, r } from "@bluelibs/runner";

describe("User registration flow", () => {
  it("creates a user, sends email, and tracks analytics", async () => {
    const mockDb = r.override(realDb, async () => new InMemoryDatabase());
    const mockMailer = r.override(realMailer, async () => ({
      send: jest.fn().mockResolvedValue(true),
    }));

    const testApp = r
      .resource("testApp")
      .register([...productionComponents])
      .overrides([mockDb, mockMailer])
      .build();

    const { runTask, getResourceValue, dispose } = await run(testApp, {
      mode: "test",
      logs: { printThreshold: null },
    });

    try {
      const user = await runTask(registerUser, {
        name: "Charlie",
        email: "charlie@test.com",
      });

      expect(user.id).toBeDefined();

      const mailer = getResourceValue(realMailer);
      expect(mailer.send).toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
```

Important override rules:

- `r.override(base, fn)` creates a replacement definition
- `.overrides([...])` accepts override definitions only
- duplicate override targets are allowed only in resolved `test` mode, whether that came from `mode: "test"` or auto-detected `NODE_ENV=test`
- in `test` mode, ancestor/descendant conflicts resolve to the outermost declaring resource
- in `test` mode, same-resource duplicates resolve to the last declaration
- unrelated duplicate override sources still fail fast, even in `test` mode
- duplicate override targets fail fast outside `test` mode
- do not place both base and override in `.register([...])`

### Capturing Execution Context in Integration Tests

Sometimes you want to assert the actual runtime path, not just the final result. Enable `executionContext` and wrap the call in `asyncContexts.execution.record(...)`.

```typescript
import { asyncContexts, run } from "@bluelibs/runner";

describe("Notifications module", () => {
  it("captures the execution tree for one integration run", async () => {
    const runtime = await run(notificationsResource, {
      executionContext: true,
      logs: { printThreshold: null },
    });

    try {
      const { result, recording } = await asyncContexts.execution.record(() =>
        runtime.runTask(processNotificationQueue, { batchId: "123" }),
      );

      expect(result).toBeDefined();
      expect(recording?.roots).toHaveLength(1);

      const root = recording!.roots[0]!;
      expect(root.frame.kind).toBe("task");
      expect(root.status).toBe("completed");
      expect(Array.isArray(root.children)).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
```

> **Platform Note:** Execution context relies on `AsyncLocalStorage`. The Node build supports it directly, and compatible Bun/Deno runtimes can support it when that primitive is available.

### Observation Strategies for Integration Tests

When an integration test fails, the real question is usually: what is the smallest surface that proves the behavior you care about?

#### 1. Override a collaborator and assert on the mock

Best when you care that an external dependency was called.

#### 2. Add a test probe resource

Best when you need to capture state from hooks, events, or resource lifecycle.

#### 3. Record the execution tree

Best when you need to prove that a task emitted an event, that hooks ran, or that the path through nested tasks is correct.

#### 4. Assert on resulting resource state

Best when the meaningful outcome is durable state, not an intermediate call.

### Logging During Tests

By default, Runner suppresses console log printing in `NODE_ENV=test` by setting `logs.printThreshold` to `null`.

If you want logs printed during a test run:

```typescript
await run(app, {
  mode: "test",
  debug: "verbose",
  logs: {
    printThreshold: "debug",
    printStrategy: "pretty",
  },
});
```

`debug: "verbose"` increases Runner instrumentation. `logs.printThreshold` controls whether anything is printed to the console.

### Testing Tips

- prefer task references over string ids so you keep type safety and autocomplete
- always `dispose()` the runtime in integration tests
- keep focused harnesses small so failures point at one feature, not the whole app
- use `.run()` for pure business logic and `runTask()` for runtime behavior
- when a test needs logs, set `logs.printThreshold` explicitly

```typescript
await runTask(registerUser, { name: "Alice", email: "alice@test.com" });

await runTask("app.tasks.registerUser", {
  name: "Alice",
  email: "alice@test.com",
});
```

The string form works, but task references are safer and easier to refactor.
