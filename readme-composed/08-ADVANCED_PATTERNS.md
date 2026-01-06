## Optional Dependencies

_Making your app resilient when services aren't available_

Sometimes you want your application to gracefully handle missing dependencies instead of crashing. Optional dependencies let you build resilient systems that degrade gracefully.

Keep in mind that you have full control over dependency registration by functionalising `dependencies(config) => ({ ... })` and `register(config) => []`.

```typescript
import { r } from "@bluelibs/runner";

const emailService = r
  .resource("app.services.email")
  .init(async () => new EmailService())
  .build();

const paymentService = r
  .resource("app.services.payment")
  .init(async () => new PaymentService())
  .build();

const userRegistration = r
  .task("app.tasks.registerUser")
  .dependencies({
    database: userDatabase, // Required - will fail if not available
    emailService: emailService.optional(), // Optional - won't fail if missing
    analytics: analyticsService.optional(), // Optional - graceful degradation
  })
  .run(async (input, { database, emailService, analytics }) => {
    // Create user (required)
    const user = await database.users.create(userData);

    // Send welcome email (optional)
    if (emailService) {
      await emailService.sendWelcome(user.email);
    }

    // Track analytics (optional)
    if (analytics) {
      await analytics.track("user.registered", { userId: user.id });
    }

    return user;
  },
});
```

**When to use optional dependencies:**

- External services that might be down
- Feature flags and A/B testing services
- Analytics and monitoring services
- Non-critical third-party integrations
- Development vs production service differences

**Benefits:**

- Graceful degradation instead of crashes
- Better resilience in distributed systems
- Easier testing with partial mocks
- Smoother development environments

> **runtime:** "Graceful degradation: your app quietly limps with a brave smile. I’ll juggle `undefined` like a street performer while your analytics vendor takes a nap. Please clap when I keep the lights on using the raw power of conditional chaining."

### Serialization

Runner ships with a graph-aware serializer that safely round-trips complex values across HTTP and between Node and the browser.

**Built-in type support:**

- `Date`, `RegExp`, `Map`, `Set`, `Error`, `Uint8Array` work out of the box
- Handles circular references and shared object identity

**Two modes:**

- `stringify()`/`parse()` — Tree mode (like JSON, throws on circular refs)
- `serialize()`/`deserialize()` — Graph mode (preserves circular refs and identity)

**Security hardened:**

- ReDoS protection validates RegExp patterns against catastrophic backtracking
- Prototype pollution blocked (`__proto__`, `constructor`, `prototype` keys filtered)
- Configurable depth limits prevent stack overflow

```ts
import { r, globals, getDefaultSerializer } from "@bluelibs/runner";

// Access via DI
const serializerSetup = r
  .resource("app.serialization.setup")
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => {
    // Tree mode (simple)
    const text = serializer.stringify({ when: new Date() });
    const obj = serializer.parse<{ when: Date }>(text);

    // Graph mode (preserves refs)
    const a = { name: "A" };
    const b = { ref: a, self: null as any };
    b.self = b; // circular
    const json = serializer.serialize(b);
    const restored = serializer.deserialize(json); // refs preserved!

    // Custom types via factory
    class Distance {
      constructor(public value: number, public unit: string) {}
      toJSONValue() {
        return { value: this.value, unit: this.unit };
      }
      typeName() {
        return "Distance";
      }
    }
    serializer.addType("Distance", (j: any) => new Distance(j.value, j.unit));
  })
  .build();

// Standalone (outside DI)
const serializer = getDefaultSerializer();
```

**Configuration options (via `new Serializer(options)`):**

- `maxDepth` — Recursion limit (default: 1000)
- `allowedTypes` — Whitelist of type IDs for deserialization
- `maxRegExpPatternLength` — Limit pattern length (default: 1024)
- `allowUnsafeRegExp` — Skip ReDoS validation (default: false)

> **Note:** File uploads use the tunnel layer's multipart handling, not the serializer. Use `createWebFile`/`createNodeFile` for uploads.

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
  .dependencies({ createClient: globals.resource.httpClientFactory })
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
