## Async Context

Ever needed to pass a request ID, user session, or trace ID through your entire call stack without threading it through every function parameter? That's what Async Context does.

It gives you **request-scoped state** that automatically flows through your async operations—no prop drilling required.

> **Platform Note**: Async Context uses Node.js's `AsyncLocalStorage` under the hood, so it's **Node.js-only**. For browsers, pass context explicitly through parameters instead.

### When to use it

- **Request tracing**: Carry a `requestId` or `traceId` through all operations
- **User sessions**: Access the current user without passing it everywhere
- **Database transactions**: Share a transaction across multiple operations
- **Logging context**: Automatically include request metadata in all logs

### Basic usage

```typescript
import { r, run } from "@bluelibs/runner";

// 1. Define your context shape
const requestContext = r
  .asyncContext<{ requestId: string; userId?: string }>("app.ctx.request")
  .build();

// 2. Wrap your request handler
async function handleRequest(req: Request) {
  await requestContext.provide({ requestId: crypto.randomUUID() }, async () => {
    // Everything inside here can access the context
    await processRequest(req);
  });
}

// 3. Read from anywhere in the call stack
async function processRequest(req: Request) {
  const ctx = requestContext.use(); // { requestId: "abc-123", userId: undefined }
  console.log(`Processing request ${ctx.requestId}`);
}
```

### Using context in tasks

The real power comes when you inject context into your tasks:

```typescript
const auditLog = r
  .task("app.tasks.auditLog")
  .dependencies({ requestContext, logger: globals.resources.logger })
  .run(async (message: string, { requestContext, logger }) => {
    const ctx = requestContext.use();
    await logger.info(message, {
      requestId: ctx.requestId,
      userId: ctx.userId,
    });
  })
  .build();

// Register the context alongside your tasks
const app = r.resource("app").register([requestContext, auditLog]).build();
```

### Requiring context with middleware

Force tasks to run only within a context boundary:

```typescript
const securedTask = r
  .task("app.tasks.secured")
  .middleware([requestContext.require()]) // Throws if context not provided
  .run(async (input) => {
    const ctx = requestContext.use(); // Guaranteed to exist
    return { processedBy: ctx.userId };
  })
  .build();
```

### Custom serialization

By default, Runner preserves Dates, RegExp, and other types across async boundaries. For custom serialization:

```typescript
const sessionContext = r
  .asyncContext<{ user: User }>("app.ctx.session")
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();
```

> **runtime:** "Async Context: your data playing hide-and-seek across the event loop. One forgotten `.provide()` and the 'Context not available' error will find you at 3am, exactly where your stack trace is least helpful."
