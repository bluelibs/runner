## Async Context



Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node). Use the fluent builder under `r.asyncContext` to create contexts that can be registered and injected as dependencies.

```typescript
import { r } from "@bluelibs/runner";

const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  // below is optional
  .configSchema(z.object({ ... }))
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();

// Provide and read within an async boundary
await requestContext.provide({ requestId: "abc" }, async () => {
  const ctx = requestContext.use(); // { requestId: "abc" }
});

// Require middleware for tasks that need the context
const requireRequestContext = requestContext.require();
```

- If you don't provide `serialize`/`parse`, Runner uses its default serializer to preserve Dates, RegExp, etc.
- A legacy `createContext(name?)` exists for backwards compatibility; prefer `r.asyncContext` or `asyncContext({ id })`.

- You can also inject async contexts as dependencies; the injected value is the helper itself. Contexts must be registered to be used.

```typescript
const whoAmI = r
  .task("app.tasks.whoAmI")
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => requestContext.use().requestId)
  .build();

const app = r.resource("app").register([requestContext, whoAmI]).build();
```

// Legacy section for Private Context - different from Async Context
