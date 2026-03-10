## Tasks

Tasks are Runner's main business operations. They are async functions with explicit dependency injection, validation, middleware support, and typed outputs.

```typescript
import { r, run } from "@bluelibs/runner";

// Assuming: emailService and logger are resources defined elsewhere.
const sendEmail = r
  .task("sendEmail")
  .dependencies({ emailService, logger })
  .run(async (input, { emailService, logger }) => {
    await logger.info(`Sending email to ${input.to}`);
    return emailService.send(input);
  })
  .build();

const app = r
  .resource("app")
  .register([emailService, logger, sendEmail])
  .build();

const { runTask, dispose } = await run(app);
const result = await runTask(sendEmail, {
  to: "user@example.com",
  subject: "Hi",
  body: "Hello!",
});

await dispose();
```

**What you just learned**: Tasks declare dependencies, execute through the runtime, and produce typed results. You can run them via `runTask()` for production or `.run()` for isolated tests.

> **Note:** Fluent `.build()` outputs are deep-frozen definitions. Treat definitions as immutable and use builder chaining, `.with()`, `.fork()`, `intercept()`, or `r.override(...)` for changes.

> **Note:** `dependencies` can be declared as an object or factory function. Factory output is resolved during bootstrap and must return an object map.

### Input and Result Validation

Tasks support schema-based validation for both input and output.
Use `.inputSchema()` (alias `.schema()`) to validate task input before execution, and `.resultSchema()` to validate the resolved return value.

```typescript
import { Match, r } from "@bluelibs/runner";

const createUser = r
  .task("createUser")
  .inputSchema(
    Match.compile({
      name: Match.NonEmptyString,
      email: Match.Email,
    }),
  )
  .resultSchema<{ id: string; name: string }>({
    parse: (v) => v,
  })
  .run(async (input) => {
    return { id: "user-1", name: input.name };
  })
  .build();
```

Validation runs before/after the task body. Invalid input or output throws immediately.

### Two Ways to Call Tasks

1. `runTask(task, input)` for production and integration flows through the full runtime pipeline
2. `task.run(input, mockDeps)` for isolated unit tests

```typescript
const testResult = await sendEmail.run(
  { to: "test@example.com", subject: "Test", body: "Testing!" },
  { emailService: mockEmailService, logger: mockLogger },
);
```

### When Something Should Be a Task

Make it a task when:

- it is a core business operation
- it needs dependency injection
- it benefits from middleware such as auth, caching, retry, or timeouts
- multiple parts of the app need to reuse it
- you want runtime observability around it

Keep it as a regular function when:

- it is a simple utility
- it is pure and dependency-free
- performance is critical and framework features add no value
- it is only used in one place

### Task Runtime Context

Task `.run(input, deps, context)` receives:

- `input`: validated task input
- `deps`: resolved dependencies
- `context`: execution-local context

Task context includes:

- `context.journal`: typed state shared with middleware
- `context.source`: `{ kind, id }` of the current task invocation

```typescript
import { journal, resources, r } from "@bluelibs/runner";

const auditKey = journal.createKey<{ startedAt: number }>("auditKey");

const sendEmail = r
  .task<{ to: string; body: string }>("sendEmail")
  .dependencies({ logger: resources.logger })
  .run(async (input, { logger }, context) => {
    context.journal.set(auditKey, { startedAt: Date.now() });
    await logger.info(`Sending email to ${input.to}`);
    return { delivered: true };
  })
  .build();
```

### ExecutionJournal

`ExecutionJournal` is typed state scoped to a single task execution.

- use it when middleware and tasks need shared execution-local state
- `journal.set(key, value)` fails if the key already exists
- pass `{ override: true }` when replacement is intentional
- create custom keys with `journal.createKey<T>(id)`
- use `journal.create()` when you need a manually managed instance

```typescript
import { journal, r } from "@bluelibs/runner";

const traceIdKey = journal.createKey<string>("traceId");

const traceMiddleware = r.middleware
  .task("traceMiddleware")
  .run(async ({ task, next, journal }) => {
    journal.set(traceIdKey, `trace:${task.definition.id}`);
    return next(task.input);
  })
  .build();

const myTask = r
  .task("myTask")
  .middleware([traceMiddleware])
  .run(async (_input, _deps, { journal, source }) => {
    const traceId = journal.get(traceIdKey);
    return { traceId, source };
  })
  .build();
```

API reference:

| Method                              | Description                                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| `journal.createKey<T>(id)`          | Create a typed key for storing values                             |
| `journal.create()`                  | Create a fresh journal instance for manual forwarding             |
| `journal.set(key, value, options?)` | Store a typed value, throwing unless `override: true` is provided |
| `journal.get(key)`                  | Retrieve a value as `T \| undefined`                              |
| `journal.has(key)`                  | Check if a key exists                                             |

### Cross-Middleware Coordination

The journal is the clean way for middleware layers to coordinate without polluting task input and output contracts.

```typescript
import { journal, r } from "@bluelibs/runner";

export const journalKeys = {
  abortController: journal.createKey<AbortController>(
    "timeout.abortController",
  ),
} as const;

export const timeoutMiddleware = r.middleware
  .task("timeoutMiddleware")
  .run(async ({ task, next, journal }, _deps, config: { ttl: number }) => {
    const controller = new AbortController();
    journal.set(journalKeys.abortController, controller);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout after ${config.ttl}ms`));
      }, config.ttl);
    });

    return Promise.race([next(task.input), timeoutPromise]);
  })
  .build();
```

Export your journal keys when you expect downstream middleware to consume the same execution-local state.

### Manual Journal Management

For advanced orchestration, you can pre-populate and forward a journal explicitly.

```typescript
const customJournal = journal.create();
customJournal.set(traceIdKey, "manual-trace-id");

const orchestratorTask = r
  .task("orchestratorTask")
  .dependencies({ myTask })
  .run(async (input, { myTask }) => {
    return myTask(input, { journal: customJournal });
  })
  .build();
```

For lifecycle-owned timers inside tasks or resources, depend on `resources.timers`.
`timers.setTimeout()` and `timers.setInterval()` stop accepting new timers once `cooldown()` starts and are cleared during `dispose()`.

> **runtime:** "Tasks: glorified functions with a resume, a chaperone, and a journal. But at least they show up in the logs when something goes wrong—unlike that anonymous arrow function in line 47."
