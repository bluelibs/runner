## Troubleshooting

When things go sideways, this is your field manual. No fluff, just fixes.

> **Note:** Unless shown otherwise, snippets assume `import { r, run, globals } from "@bluelibs/runner";` and any external libraries (Express, database clients) are already set up.

---

### Error Index

The quick-reference table for "I've seen this error, what do I do?"

| Error                                   | Symptom                             | Likely Cause                                  | Fix                                                         |
| --------------------------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `TypeError: X is not a function`        | Task call fails at runtime          | Forgot `.build()` on task/resource definition | Add `.build()` at the end of your fluent chain              |
| `Resource "X" not found`                | Runtime crash during initialization | Component not registered                      | Add to `.register([...])` in parent resource                |
| `Config validation failed for X`        | Startup crash before app runs       | Missing `.with()` config for resource         | Provide required config: `resource.with({ ... })`           |
| `Circular dependency detected`          | TypeScript inference fails          | Import cycle between files                    | Use explicit type annotation: `as IResource<Config, Value>` |
| `TimeoutError`                          | Task hangs then throws              | Operation exceeded timeout TTL                | Increase TTL or investigate underlying slow operation       |
| `Cannot read property 'X' of undefined` | Task crashes mid-execution          | Dependency not properly injected              | Check `.dependencies({})` matches what you use              |
| `ValidationError: Task input...`        | Task rejects valid-looking input    | Input doesn't match `inputSchema`             | Check schema constraints (types, required fields)           |
| `RateLimitError`                        | Task throws after repeated calls    | Exceeded rate limit threshold                 | Wait for window reset or increase `max` limit               |
| `CircuitBreakerOpenError`               | All calls fail immediately          | Circuit tripped after failures                | Wait for `resetTimeout` or fix underlying service           |

---

### Common First Failures

New to Runner? These are the mistakes everyone makes (yes, everyone):

#### Forgot `.build()`

```typescript
// Wrong - returns a builder, not a usable task
const myTask = r.task("app.tasks.myTask").run(async () => "hello");

// Right - returns the actual task
const myTask = r
  .task("app.tasks.myTask")
  .run(async () => "hello")
  .build(); // <- This is required!
```

**Symptom**: `TypeError: myTask is not a function` or strange type errors.

#### Forgot to Register

```typescript
const database = r
  .resource("app.db")
  .init(async () => connection)
  .build();
const myTask = r
  .task("app.tasks.work")
  .dependencies({ database })
  .run(async (_, { database }) => database.query())
  .build();

// Wrong - myTask depends on database but database isn't registered
const app = r.resource("app").register([myTask]).build();

// Right - register ALL components
const app = r.resource("app").register([database, myTask]).build();
```

**Symptom**: `Resource "app.db" not found` at runtime.

**Remember**: `dependencies` says "I need these" — `register` says "these exist".

#### Missing `.with()` Config

```typescript
// Resource requires configuration
const server = r
  .resource<{ port: number }>("app.server")
  .init(async ({ port }) => startServer(port))
  .build();

// Wrong - no config provided
const app = r.resource("app").register([server]).build();

// Right - provide config with .with()
const app = r
  .resource("app")
  .register([server.with({ port: 3000 })])
  .build();
```

**Symptom**: TypeScript error about missing config, or runtime validation error.

#### Calling Task Before Runtime

```typescript
// Wrong - can't call task directly without runtime
const result = await myTask({ input: "data" }); // Fails!

// Right - get runtime first, then call
const { runTask, dispose } = await run(app);
const result = await runTask(myTask, { input: "data" });
await dispose();
```

**Symptom**: Dependencies undefined, middleware not applied, chaos.

---

### Debug Mode

When you need to see what's happening under the hood:

```typescript
// Enable verbose debugging
const { runTask, dispose } = await run(app, {
  debug: "verbose",
  logs: { printThreshold: "debug" },
});
```

**What you'll see:**

```
[DEBUG] [runner] Initializing resource: app.database
[DEBUG] [runner] Resource initialized: app.database (12ms)
[DEBUG] [runner] Initializing resource: app.server
[DEBUG] [runner] Resource initialized: app.server (3ms)
[DEBUG] [runner] Executing task: app.tasks.createUser
[DEBUG] [runner]   Input: { "name": "Ada", "email": "ada@example.com" }
[DEBUG] [runner]   Result: { "id": "user-123", "name": "Ada" }
[DEBUG] [runner] Task completed: app.tasks.createUser (5ms)
[DEBUG] [runner] Emitting event: app.events.userCreated
[DEBUG] [runner] Hook triggered: app.hooks.sendWelcomeEmail
```

**Debug levels:**

| Level       | What's logged                                        |
| ----------- | ---------------------------------------------------- |
| `"normal"`  | Lifecycle events, errors, event emissions            |
| `"verbose"` | All of above + task inputs/outputs, resource configs |

**Per-component debugging:**

```typescript
// Only debug specific tasks
const criticalTask = r
  .task("app.tasks.payment")
  .tags([globals.tags.debug.with({ logTaskInput: true, logTaskOutput: true })])
  .run(async (input) => processPayment(input))
  .build();
```

---

### Diagnosing Slow Performance

If things are slower than expected:

**1. Check middleware order** — faster middleware should come first:

```typescript
// Good - fast checks first
.middleware([
  authCheck,        // ~0.1ms - fails fast if unauthorized
  rateLimit,        // ~0.5ms - blocks before expensive work
  timeout,          // wraps the slow stuff
  expensiveLogging, // can afford to be slow
])
```

**2. Look for missing cache hits:**

```typescript
await run(app, { debug: "verbose" });
// Watch for: "Cache miss for app.tasks.expensive" vs "Cache hit"
```

**3. Profile initialization:**

```typescript
const start = Date.now();
const { dispose } = await run(app);
console.log(`App initialized in ${Date.now() - start}ms`);
```

---

### Lifecycle Issues

#### Resources not disposing properly

**Symptom**: Hanging process, "port already in use" on restart, connection leaks.

**Fix**: Ensure every resource with setup has matching cleanup:

```typescript
const server = r
  .resource<{ port: number }>("app.server")
  .init(async ({ port }) => {
    const app = express();
    const listener = app.listen(port);
    return { app, listener };
  })
  .dispose(async ({ listener }) => {
    // Don't forget this!
    return new Promise((resolve) => listener.close(resolve));
  })
  .build();
```

#### Shutdown hanging forever

**Symptom**: `dispose()` never resolves.

**Likely causes**:

1. Dispose function has unresolved promise
2. A resource left open handles (timers/sockets)
3. Circular await in dispose chain

**Debug approach**:

```typescript
const { dispose } = await run(app);

// Add timeout to identify hanging dispose
const timeout = setTimeout(() => {
  console.error("Dispose hanging - check resource cleanup");
  process.exit(1);
}, 10000);

await dispose();
clearTimeout(timeout);
```

---

### TypeScript Issues

#### Circular Type Inference

**Symptom**: TypeScript shows `any` or fails to infer types in circular imports.

**Solution**: Explicitly type the resource that closes the loop:

```typescript
// Break the inference chain with explicit typing
export const problematicResource = r
  .resource("app.problematic")
  .dependencies({ otherResource })
  .init(async (_, { otherResource }) => {
    return { value: otherResource.something };
  })
  .build() as IResource<void, { value: string }>;
```

See [Handling Circular Dependencies](#handling-circular-dependencies) for full patterns.

#### Type Errors with Middleware Contracts

**Symptom**: Task input/output types don't match middleware expectations.

**Fix**: Ensure task satisfies all middleware contracts:

```typescript
// Middleware expects { user: { role: string } } input
const authMiddleware = r.middleware.task<
  { requiredRole: string },
  { user: { role: string } },
  unknown
>("auth");
// ...

// Task MUST have compatible input type
const adminTask = r
  .task("admin")
  .middleware([authMiddleware.with({ requiredRole: "admin" })])
  .run(async (input: { user: { role: string } /* other fields */ }) => {
    // input.user.role is available and typed
  })
  .build();
```

---

### Filing a Good Issue

When you need help, include this information:

```markdown
## Environment

- @bluelibs/runner version: X.X.X
- Node.js version: X.X.X
- TypeScript version: X.X.X
- OS: macOS/Windows/Linux

## Minimal Reproduction

\`\`\`typescript
// Smallest possible code that reproduces the issue
import { r, run } from "@bluelibs/runner";

const app = r.resource("app").build();
await run(app); // Describe what goes wrong here
\`\`\`

## Expected Behavior

What should happen.

## Actual Behavior

What actually happens.

## Error Output

\`\`\`
Full stack trace here
\`\`\`

## Debug Logs

\`\`\`
Output from: await run(app, { debug: "verbose" })
\`\`\`
```

**Get your version:**

```bash
npm ls @bluelibs/runner
```

**Pro tips:**

- Minimal reproduction > walls of code
- Stack traces > "it doesn't work"
- Debug logs often reveal the issue before you file

---

### Still Stuck?

1. **Search existing issues**: [GitHub Issues](https://github.com/bluelibs/runner/issues)
2. **Check examples**: [Examples directory](https://github.com/bluelibs/runner/tree/main/examples)
3. **Ask the AI**: [Runner Chatbot](https://chatgpt.com/g/g-68b756abec648191aa43eaa1ea7a7945-runner)
4. **Open an issue**: [New Issue](https://github.com/bluelibs/runner/issues/new)

> **runtime:** "Troubleshooting: the archaeological dig through your own decisions. You ask 'why is this broken?' and I ask 'did you call .build()?' Nine times out of ten, we both know the answer. The tenth time, it's genuinely my fault. File an issue. I'll wait."

---
