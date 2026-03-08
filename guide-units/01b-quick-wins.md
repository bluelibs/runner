## Quick Wins: Pressure-Tested Recipes

Use this page when you already understand the basic Runner shape and want a production-oriented pattern quickly. These recipes focus on Runner wiring. External collaborators such as `db`, `fetch`, `emailService`, `fs`, or `chargeCard` are called out explicitly when assumed.

| Problem                  | Use This For                     | Boundary                                         | Jump to                                                         |
| ------------------------ | -------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Production debugging     | Add structured logs first        | Works anywhere Runner logging is available        | [Logging](#add-structured-logging-with-context)                 |
| Hanging operations       | Put a hard cap on task duration  | Middleware example; task body is app-specific     | [Timeouts](#add-request-timeouts-to-stop-hanging-operations)    |
| Flaky external APIs      | Retry transient failures         | Use typed/domain errors for permanent failures    | [Retry](#retry-failed-api-calls-with-exponential-backoff)       |
| Expensive repeated calls | Cache deterministic task results | Assumes a `db` dependency already exists          | [Caching](#add-caching-to-a-task-with-explicit-dependencies)    |
| Tight coupling           | Emit events instead of callbacks | Assumes your user persistence lives elsewhere     | [Events](#set-up-event-driven-architecture-in-30-seconds)       |
| Race conditions          | Serialize work per key           | Node-only if you use `fs`; queue is single-process | [Queue](#prevent-race-conditions-with-a-per-process-queue)      |

### Add Structured Logging with Context

**Use when**: you need better production visibility before adding more policies.

```typescript
import { r, resources } from "@bluelibs/runner";

const processPayment = r
  .task("processPayment")
  .dependencies({ logger: resources.logger })
  .run(async (input: { orderId: string; amount: number }, { logger }) => {
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
```

**Why it helps**: every log already knows which task produced it, so you get structured context without threading logger metadata through every helper.

**Limit**: `chargeCard` is your own collaborator; this recipe shows the Runner wiring around it.

### Add Request Timeouts to Stop Hanging Operations

**Use when**: the dangerous failure mode is a task that never returns.

```typescript
import { middleware, r } from "@bluelibs/runner";

const slowOperation = r
  .task("slowOperation")
  .middleware([middleware.task.timeout.with({ ttl: 5000 })])
  .run(async () => {
    return await someSlowDatabaseQuery();
  })
  .build();

const robustTask = r
  .task("robustTask")
  .middleware([
    middleware.task.retry.with({ retries: 3 }),
    middleware.task.timeout.with({ ttl: 10000 }),
  ])
  .run(async () => await unreliableOperation())
  .build();
```

**Why it helps**: the timeout middleware makes latency limits explicit instead of relying on ad hoc `Promise.race` wrappers in application code.

**Limit**: `someSlowDatabaseQuery` and `unreliableOperation` are application-specific. This recipe is about the timeout policy, not the dependency implementation.

### Retry Failed API Calls with Exponential Backoff

**Use when**: an external system fails transiently and a short retry window is acceptable.

```typescript
import { Match, middleware, r } from "@bluelibs/runner";

const externalApiFailed = r
  .error("externalApiFailed")
  .dataSchema({
    status: Match.Optional(Match.Integer),
    url: Match.NonEmptyString,
  })
  .build();

const callExternalApi = r
  .task("callExternalApi")
  .middleware([
    middleware.task.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 100 * 2 ** attempt,
      stopRetryIf: (error) => error?.status === 404,
    }),
  ])
  .run(async (url: string) => {
    const response = await fetch(url);

    if (!response.ok) {
      throw externalApiFailed({
        status: response.status,
        url,
      });
    }

    return response.json();
  })
  .build();
```

**Why it helps**: retry behavior stays declarative and visible in the task definition instead of being mixed into the fetch logic.

**Limit**: retrying everything is usually wrong. Use typed errors or a predicate that encodes which failures are truly transient.

### Add Caching to a Task with Explicit Dependencies

**Use when**: the same deterministic request is repeated often enough to justify memoization.

```typescript
import { middleware, r } from "@bluelibs/runner";

// Assuming: `db` is a resource defined elsewhere.
const getUser = r
  .task<{ id: string }>("getUser")
  .dependencies({ db })
  .middleware([
    middleware.task.cache.with({
      ttl: 60 * 1000,
      keyBuilder: (_taskId, input) => `user:${input.id}`,
    }),
  ])
  .run(async (input, { db }) => {
    return await db.users.findOne({ id: input.id });
  })
  .build();
```

**Why it helps**: caching becomes part of the task contract, which keeps the policy visible in one place and easy to remove or tune later.

**Limit**: this example assumes a `db` resource already exists. It is intentionally partial so the caching concern stays isolated.

### Set Up Event-Driven Architecture in 30 Seconds

**Use when**: one task should announce something happened without owning every downstream side effect.

```typescript
import { Match, r } from "@bluelibs/runner";

const userRegistered = r
  .event("userRegistered")
  .payloadSchema(
    Match.compile({
      userId: Match.NonEmptyString,
      email: Match.Email,
    }),
  )
  .build();

// Assuming: createUserInDb and emailService are defined elsewhere.
const registerUser = r
  .task("registerUser")
  .dependencies({ userRegistered })
  .run(async (input, { userRegistered }) => {
    const user = await createUserInDb(input);
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  })
  .build();

const sendWelcomeEmail = r
  .hook("sendWelcomeEmail")
  .on(userRegistered)
  .run(async (event) => {
    await emailService.send({
      to: event.data.email,
      subject: "Welcome!",
      body: "Thanks for joining!",
    });
  })
  .build();
```

**Why it helps**: the task owns the business action while hooks own reactions, so follow-up behavior can grow without bloating the task.

**Limit**: this snippet assumes your persistence and email integrations already exist.

### Prevent Race Conditions with a Per-Process Queue

**Use when**: one logical key must run sequentially inside a single process.

**Boundary**: this example is Node-oriented because it uses `fs`, and the queue only coordinates work inside one Runner process.

```typescript
import { resources, r } from "@bluelibs/runner";
import { promises as fs } from "node:fs";

const writeConfig = r
  .task<{ key: string; value: string }>("writeConfig")
  .dependencies({ queue: resources.queue })
  .run(async (input, { queue }) => {
    return await queue.run(`config:${input.key}`, async () => {
      await fs.writeFile(
        `/config/${input.key}.json`,
        JSON.stringify(input.value),
      );

      return { written: true };
    });
  })
  .build();
```

**Why it helps**: you get deterministic per-key sequencing without inventing your own in-memory lock management.

**Limit**: this is not a distributed lock. If multiple processes can write the same key, you need a cross-process coordination strategy.

### Wire the Recipes into an App

```typescript
import { r, run } from "@bluelibs/runner";

const app = r
  .resource("app")
  .register([
    processPayment,
    slowOperation,
    robustTask,
    callExternalApi,
    getUser,
    userRegistered,
    registerUser,
    sendWelcomeEmail,
    writeConfig,
  ])
  .build();

const { runTask, dispose } = await run(app);

await runTask(getUser, { id: "123" });
await dispose();
```

**What you just learned**: Quick Wins works best as a catalog of policies you can add after the basic `task -> app -> run()` flow is already clear.

> **runtime:** "You wanted reliability primitives without building a private framework out of helper functions and regret. Sensible."
