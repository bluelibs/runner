## Advanced Patterns

This section covers patterns for building resilient, distributed applications. Use these when your app grows beyond a single process or needs to handle partial failures gracefully.

---

## Optional Dependencies

What happens when your analytics service is down? Or your email provider is rate-limiting? With optional dependencies, your app keeps running instead of crashing.

### The problem

```typescript
// Without optional dependencies - if analytics is down, the whole task fails
const registerUser = r
  .task("users.register")
  .dependencies({ database, analytics }) // analytics must be available!
  .run(async (input, { database, analytics }) => {
    const user = await database.create(input);
    await analytics.track("user.registered"); // 💥 Crashes if analytics is down
    return user;
  })
  .build();
```

### The solution

```typescript
import { r } from "@bluelibs/runner";

const registerUser = r
  .task("users.register")
  .dependencies({
    database, // Required - task fails if missing
    analytics: analyticsService.optional(), // Optional - undefined if missing
    email: emailService.optional(), // Optional - graceful degradation
  })
  .run(async (input, { database, analytics, email }) => {
    // Core logic always runs
    const user = await database.create(input);

    // Optional services fail silently
    await analytics?.track("user.registered");
    await email?.sendWelcome(user.email);

    return user;
  })
  .build();
```

### When to use optional dependencies

| Use Case                  | Example                                            |
| ------------------------- | -------------------------------------------------- |
| **Non-critical services** | Analytics, metrics, feature flags                  |
| **External integrations** | Third-party APIs that may be flaky                 |
| **Development shortcuts** | Skip services not running locally                  |
| **Feature toggles**       | Conditionally enable functionality                 |
| **Gradual rollouts**      | New services that might not be deployed everywhere |

### Dynamic dependencies

For more control, you can compute dependencies based on config:

```typescript
const myTask = r
  .task("app.tasks.flexible")
  .dependencies((config) => ({
    database,
    // Only include analytics in production
    ...(config.enableAnalytics ? { analytics } : {}),
  }))
  .run(async (input, deps) => {
    // deps.analytics may or may not exist
  })
  .build();
```

---

## Serialization

Ever sent a `Date` over JSON and gotten `"2024-01-15T..."` back as a string? Runner's serializer preserves types across the wire.

### What it handles

| Type          | JSON   | Runner Serializer |
| ------------- | ------ | ----------------- |
| `Date`        | String | Date object       |
| `RegExp`      | Lost   | RegExp object     |
| `Map`, `Set`  | Lost   | Preserved         |
| `Uint8Array`  | Lost   | Preserved         |
| Circular refs | Error  | Preserved         |

### Two modes

```typescript
import { getDefaultSerializer } from "@bluelibs/runner";

const serializer = getDefaultSerializer();

// Tree mode - like JSON.stringify, but type-aware
const json = serializer.stringify({ when: new Date(), pattern: /hello/i });
const obj = serializer.parse(json);
// obj.when is a Date, obj.pattern is a RegExp

// Graph mode - handles circular references
const user = { name: "Alice" };
const team = { members: [user], lead: user }; // shared reference
user.team = team; // circular reference

const data = serializer.serialize(team);
const restored = serializer.deserialize(data);
// restored.members[0] === restored.lead (same object!)
```

### Custom types

Teach the serializer about your own classes:

```typescript
class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}

  // Required methods for serialization
  typeName() {
    return "Money";
  }
  toJSONValue() {
    return { amount: this.amount, currency: this.currency };
  }
}

// Register the type
serializer.addType("Money", (json) => new Money(json.amount, json.currency));

// Now it round-trips correctly
const price = new Money(99.99, "USD");
const json = serializer.stringify({ price });
const { price: restored } = serializer.parse(json);
// restored instanceof Money === true
```

### Security features

The serializer is hardened against common attacks:

- **ReDoS protection**: Validates RegExp patterns against catastrophic backtracking
- **Prototype pollution blocked**: Filters `__proto__`, `constructor`, `prototype` keys
- **Depth limits**: Configurable max depth prevents stack overflow

> **Note:** File uploads use the tunnel layer's multipart handling, not the serializer. See [Tunnels](./readmes/TUNNELS.md) for file upload patterns.

### Tunnels: Bridging Runners

Tunnels are a powerful feature for building distributed systems. They let you expose your tasks and events over HTTP, making them callable from other processes, services, or even a browser UI. This allows a server and client to co-exist, enabling one Runner instance to securely call another.

Here's a sneak peek of how you can expose your application and configure a client tunnel to consume a remote Runner:

```typescript
import { r, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

let app = r.resource("app");

if (process.env.SERVER) {
  // 1. Expose your local tasks and events over HTTP, only when server mode is active.
  app.register([
    // ... your tasks and events
    nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { port: 7070 },
      },
    }),
  ]);
}
app = app.build();

// 2. In another app, define a tunnel resource to call a remote Runner
const remoteTasksTunnel = r
  .resource("app.tunnels.http")
  .tags([globals.tags.tunnel])
  .dependencies({ createClient: globals.resources.httpClientFactory })
  .init(async (_, { createClient }) => ({
    mode: "client", // or "server", or "none", or "both" for emulating network infrastructure
    transport: "http", // the only one supported for now
    // Selectively forward tasks starting with "remote.tasks."
    tasks: (t) => t.id.startsWith("remote.tasks."),
    client: createClient({
      url: "http://remote-runner:8080/__runner",
    }),
  }))
  .build();
```

This is just a glimpse. With tunnels, you can build microservices, CLIs, and admin panels that interact with your main application securely and efficiently.

For a deep dive into streaming, authentication, file uploads, and more, check out the [full Tunnels documentation](./readmes/TUNNELS.md).
