## Testing



### Unit Testing

Unit testing is straightforward because everything is explicit:

```typescript
describe("registerUser task", () => {
  it("should create a user and emit event", async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({ id: "123", name: "John" }),
    };
    const mockEvent = jest.fn();

    const result = await registerUser.run(
      { name: "John", email: "john@example.com" },
      { userService: mockUserService, userRegistered: mockEvent },
    );

    expect(result.id).toBe("123");
    expect(mockEvent).toHaveBeenCalledWith({
      userId: "123",
      email: "john@example.com",
    });
  });
});
```

### Integration Testing

Spin up your whole app, keep all the middleware/events, and still test like a human. The `run()` function returns a `RunnerResult`.

This contains the classic `value` and `dispose()` but it also exposes `logger`, `runTask()`, `emitEvent()`, and `getResourceValue()` by default.

Note: The default `printThreshold` inside tests is `null` not `info`. This is verified via `process.env.NODE_ENV === 'test'`, if you want to see the logs ensure you set it accordingly.

```typescript
import { run, r, override } from "@bluelibs/runner";

// Your real app
const app = r
  .resource("app")
  .register([
    /* tasks, resources, middleware */
  ])
  .build();

// Optional: overrides for infra (hello, fast tests!)
const testDb = r
  .resource("app.database")
  .init(async () => new InMemoryDb())
  .build();
// If you use with override() it will enforce the same interface upon the overriden resource to ensure typesafety
const mockMailer = override(realMailer, { init: async () => fakeMailer });

// Create the test harness
const harness = r.resource("test").overrides([mockMailer, testDb]).build();

// A task you want to drive in your tests
const registerUser = r
  .task("app.tasks.registerUser")
  .run(async () => ({}))
  .build();

// Boom: full ecosystem
const { value: t, dispose } = await run(harness);

// You have 3 ways to interact with the system, run tasks, get resource values and emit events
// You can run them dynamically with just string ids, but using the created objects gives you type-safety.

const result = await t.runTask(registerUser, { email: "x@y.z" });
const value = t.getResourceValue(testDb); // since the resolution is done by id, this will return the exact same result as t.getResourceValue(actualDb)
t.emitEvent(event, payload);
expect(result).toMatchObject({ success: true });
await dispose();
```

When you're working with the actual task instances you benefit of autocompletion, if you rely on strings you will not benefit of autocompletion and typesafety for running these tasks.

> **runtime:** "Testing: an elaborate puppet show where every string behaves. Then the real world walks in, kicks the stage, and asks for pagination. Still—nice coverage badge."

