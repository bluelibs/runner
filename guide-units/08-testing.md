## Testing

Runner's explicit dependency injection makes testing straightforward. Call `.run()` on a task with plain mocks for fast unit tests, or spin up the full runtime when you need middleware and lifecycle behavior.

### Three Testing Approaches

| Approach                | Speed    | What runs          | Best for                     |
| ----------------------- | -------- | ------------------ | ---------------------------- |
| **Unit test**           | Fast     | Just your function | Logic, edge cases            |
| **Focused Integration** | Moderate | Subtree + runtime  | Feature modules in isolation |
| **Full Integration**    | Slower   | Full pipeline      | End-to-end flows, wiring     |

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

### Focused Integration Testing (Moderate, Subtree Only)

Because Runner applications are explicit graphs of definitions, you don't need to spin up the entire app to test a feature module. You can spin up a specific resource (or a subset of resources) and mock only the external dependencies that module requires.

This is extremely powerful because you get real middleware, event dispatching, and lifecycle events running exclusively for that isolated subtree, while overriding anything it would otherwise expect from the rest of the application.

```typescript
import { run, r } from "@bluelibs/runner";
import {
  notificationsResource,
  processNotificationQueue,
} from "./notifications";
import { emailResource } from "./email";

describe("Notifications module", () => {
  it("processes notifications correctly", async () => {
    // Override whatever external dependencies the notifications subtree relies on
    const mockEmailProvider = r.override(emailResource, async () => ({
      send: jest.fn().mockResolvedValue(true),
    }));

    // Create a focused test harness
    const testHarness = r
      .resource("test-harness")
      .register([
        notificationsResource,
        emailResource, // owns/registers emailResource in the graph
      ])
      .overrides([mockEmailProvider]) // can mock it.
      .build();

    const { runTask, dispose } = await run(testHarness);
    try {
      // You are now testing real middleware, hooks, and tasks
      // contained just in `notificationsResource` without booting up
      // databases, queues, or other unrelated heavy systems.
      await runTask(processNotificationQueue, { batchId: "123" });

      // ... assertions ...
    } finally {
      await dispose();
    }
  });
});
```

The important rule is ownership: an override only works if the target definition is actually registered in the harness graph, and the harness declares the override from the same resource that owns that subtree or from one of its ancestors. If a dependency is contributed by another resource, register that owning resource in the test harness, then override the specific definition you want to swap.

When multiple overrides target the same id in `test` mode, Runner resolves them by ancestry: the outermost declaring resource wins. That lets a top-level harness replace a mock contributed by a deeper shared fixture without rewriting the fixture itself.

```typescript
const nestedMockMailer = r.override(realMailer, async () => ({
  send: jest.fn().mockResolvedValue("nested"),
}));

const sharedFixture = r
  .resource("shared-fixture")
  .register([realMailer])
  .overrides([nestedMockMailer])
  .build();

const harnessMockMailer = r.override(realMailer, async () => ({
  send: jest.fn().mockResolvedValue("harness"),
}));

const testHarness = r
  .resource("test-harness")
  .register([sharedFixture])
  .overrides([harnessMockMailer])
  .build();

const runtime = await run(testHarness, { mode: "test" });
const mailer = runtime.getResourceValue(realMailer);
expect(await mailer.send()).toBe("harness");
```

### Full Integration Testing (Full Pipeline)

Use `run()` to start the full app with middleware, events, and lifecycle. Swap infrastructure with `override()`.

Important:

- `r.override(base, fn)` creates a replacement definition.
- `.overrides([...])` only accepts override-produced definitions.
- Duplicate override targets still fail fast outside `test` mode.
- In `test` mode, duplicate override targets are allowed and the outermost declaring resource wins.
- If you place both base and replacement in `.register([...])`, you'll get duplicate-id registration errors.

```typescript
import { run, r } from "@bluelibs/runner";

describe("User registration flow", () => {
  it("creates user, sends email, and tracks analytics", async () => {
    // Swap infrastructure with test doubles
    const mockDb = r.override(realDb, async () => new InMemoryDatabase());
    const mockMailer = r.override(realMailer, async () => ({
      send: jest.fn().mockResolvedValue(true),
    }));

    const testApp = r
      .resource("test")
      .register([...productionComponents])
      .overrides([mockDb, mockMailer])
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

### Capturing Execution Context In Integration Tests

Sometimes the final assertion is not enough and you want to inspect the exact execution path for one runtime call. Enable `executionContext` and wrap the task run in `asyncContexts.execution.record(...)` to capture the full execution tree.

This is useful when you want to verify that a task emitted an event, that hooks executed downstream, or that Runner followed the path you expect through nested task calls. If your runtime uses lightweight execution context with `frames: "off"`, `record(...)` temporarily promotes the callback to full frame tracking.

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
      expect(recording).toBeDefined();
      expect(recording?.roots).toHaveLength(1);

      const root = recording!.roots[0]!;
      expect(root.frame.kind).toBe("task");
      expect(root.frame.id).toContain("processNotificationQueue");
      expect(root.status).toBe("completed");
      expect(root.error).toBeUndefined();
      expect(Array.isArray(root.children)).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
```

The recording is a tree of `ExecutionRecordNode` values. The runtime does not store task inputs or outputs here, only execution structure, timing, and status.

```typescript
interface ExecutionFrame {
  kind: "task" | "event" | "hook";
  id: string;
  source: RuntimeCallSource; // canonical `{ kind, id }`
  timestamp: number;
}

interface ExecutionRecordNode {
  id: string;
  frame: ExecutionFrame;
  startedAt: number;
  endedAt: number | undefined;
  status: "running" | "completed" | "failed";
  error: unknown;
  children: readonly ExecutionRecordNode[];
}

interface ExecutionRecordSnapshot {
  correlationId: string;
  startedAt: number;
  finishedAt: number;
  roots: readonly ExecutionRecordNode[];
}
```

> **Platform Note:** Execution context relies on `AsyncLocalStorage`. The Node build supports it directly, and compatible Bun/Deno runtimes can support it when that primitive is available.

### Observation Strategies For Integration Tests

When an integration test fails, the real question is usually: what is the cleanest surface to observe? Prefer the smallest strategy that proves the behavior you care about.

#### 1. Override a collaborator and assert on the mock

Use this when you care that your code called an external dependency correctly.

- Best for: mailers, gateways, queues, repositories, SDK wrappers
- Assertion style: "Was this dependency called with the right data?"

#### 2. Add a test probe resource

Use a small test-only resource when you want to observe built-in systems such as `resources.logger`, `resources.eventManager`, `resources.taskRunner`, or `resources.middlewareManager` without replacing them.

```typescript
import { r, resources } from "@bluelibs/runner";

const testProbe = r
  .resource("testProbe")
  .dependencies({
    eventManager: resources.eventManager,
    logger: resources.logger,
  })
  .init(async (_config, { eventManager, logger }) => {
    const emittedEventIds: string[] = [];
    const logs: string[] = [];

    eventManager.intercept(async (next, emission) => {
      emittedEventIds.push(String(emission.id));
      return next(emission);
    });

    logger.onLog((log) => {
      logs.push(log.message);
    });

    return { emittedEventIds, logs };
  })
  .build();
```

- Best for: "Which events were emitted?", "What did the logger receive?", "Did global interception fire?"
- Assertion style: get the probe value with `runtime.getResourceValue(testProbe)` and inspect what it captured

#### 3. Record the execution tree

Use `asyncContexts.execution.record(...)` when you want the causal path back for one test run.

- Best for: nested task -> event -> hook chains, repeated paths, loop diagnosis
- Assertion style: inspect `recording.roots`, `frame.kind`, `children`, and `correlationId`

#### 4. Assert on resulting resource state

Use `runtime.getResourceValue(...)` when the most important signal is durable in-memory state after the run finishes.

- Best for: stores, accumulators, caches, in-memory projections
- Assertion style: "What state does the resource hold now?"

In practice:

- Start with collaborator assertions when the dependency call is the contract.
- Use a probe resource when you need to observe framework-level behavior.
- Use execution recording when the sequence itself matters.
- Use resource-state assertions when outcomes are easier to verify than intermediate steps.

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

// Works but no type checking, and can fail when refactoring
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
