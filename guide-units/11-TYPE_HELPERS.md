## Type Helpers

These utility types help you extract the generics from tasks, resources, and events without re-declaring them. Import them from `@bluelibs/runner`.

```ts
import { r } from "@bluelibs/runner";
import type {
  ExtractTaskInput,
  ExtractTaskOutput,
  ExtractResourceConfig,
  ExtractResourceValue,
  ExtractEventPayload,
} from "@bluelibs/runner";

// Task example
const add = r
  .task("calc.add")
  .run(async (input: { a: number; b: number }) => input.a + input.b)
  .build();

type AddInput = ExtractTaskInput<typeof add>; // { a: number; b: number }
type AddOutput = ExtractTaskOutput<typeof add>; // number

// Resource example
const config = r
  .resource("app.config")
  .init(async (cfg: { baseUrl: string }) => ({ baseUrl: cfg.baseUrl }))
  .build();

type ConfigInput = ExtractResourceConfig<typeof config>; // { baseUrl: string }
type ConfigValue = ExtractResourceValue<typeof config>; // { baseUrl: string }

// Event example
const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();
type UserRegisteredPayload = ExtractEventPayload<typeof userRegistered>; // { userId: string; email: string }
```

### Context with Middleware

Context shines when combined with middleware for request-scoped data:

```typescript
import { r } from "@bluelibs/runner";
import { randomUUID } from "crypto";

const requestContext = r
  .asyncContext<{
    requestId: string;
    startTime: number;
    userAgent?: string;
  }>("app.requestContext")
  .build();

const requestMiddleware = r.middleware
  .task("app.middleware.request")
  .run(async ({ task, next }) => {
    // This works even in express middleware if needed.
    return requestContext.provide(
      {
        requestId: randomUUID(),
        startTime: Date.now(),
        userAgent: "MyApp/1.0",
      },
      async () => {
        return next(task?.input);
      },
    );
  })
  .build();

const handleRequest = r
  .task("app.handleRequest")
  .middleware([requestMiddleware])
  .run(async (input: { path: string }) => {
    const request = requestContext.use();
    console.log(`Processing ${input.path} (Request ID: ${request.requestId})`);
    return { success: true, requestId: request.requestId };
  })
  .build();
```

> **runtime:** "Context: global state with manners. You invented a teleporting clipboard for data and called it 'nice.' Forget to `provide()` once and I’ll unleash the 'Context not available' banshee scream exactly where your logs are least helpful."
