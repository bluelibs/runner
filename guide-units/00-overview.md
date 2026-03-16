## Why Runner?

When a TypeScript service grows past a few dependencies, the pain usually shows up in the same places: startup order becomes tribal knowledge, cross-cutting concerns leak into business logic, and testing means reconstructing half the app. Runner makes those seams explicit. You wire dependencies in code, keep lifecycle in one place, and choose when to execute a unit directly versus through the full runtime.

### The Core Promise

Runner is for teams that want explicit composition without class decorators, reflection, or framework-owned magic.

- **Before Runner**: manual wiring, ad hoc startup and shutdown, inconsistent test setup, policies scattered across handlers
- **With Runner**: explicit dependency maps, resource lifecycle, middleware for cross-cutting concerns, direct unit testing or full runtime execution

### A Small, Runnable Example

Start with one resource, one task, and one app. This example is intentionally small enough to run as-is.

```typescript
import { r, run } from "@bluelibs/runner";

const userStore = r
  .resource("userStore")
  .init(async () => new Map<string, { id: string; email: string }>())
  .build();

const createUser = r
  .task<{ email: string }>("createUser")
  .dependencies({ userStore })
  .run(async (input, { userStore }) => {
    const user = { id: "user-1", email: input.email };
    userStore.set(user.id, user);
    return user;
  })
  .build();

const app = r.resource("app").register([userStore, createUser]).build();

const { runTask, dispose } = await run(app);

console.log(await runTask(createUser, { email: "ada@example.com" }));
await dispose();
```

**What this proves**: the smallest Runner app still has explicit wiring, a runtime boundary, and reusable units.

### Why It Appeals to Senior TypeScript Teams

- **Architecture you can enforce, not just document**: dependency graphs, isolation boundaries, and lifecycle contracts are validated at bootstrap — not left to code review
- **No decorators, no reflection, no magic**: composition is plain TypeScript functions and explicit builder chains — fully tree-shakeable, fully debuggable
- **Lifecycle that doesn't leak**: `init → ready → cooldown → dispose` lives with the resource definition, so startup order and graceful shutdown stop being tribal knowledge
- **Test any unit in isolation or through the full runtime**: call `.run()` directly for a pure unit test, or `runTask()` for the real middleware + validation + DI path — same definition, both modes
- **Cross-cutting concerns without pollution**: retry, rate-limit, caching, circuit-breaker, timeout — attach as middleware instead of wrapping every handler
- **Incremental adoption**: wrap one service or one task, prove the value, then expand — Runner doesn't need to own your whole app

### Tradeoffs and Boundaries

Runner is not trying to be the lowest-ceremony option for tiny scripts.

- You write some setup code up front so the graph stays explicit later.
- The best payoff appears once your app has multiple long-lived services or cross-cutting policies.
- Some features are intentionally platform-specific.
  Async Context, Durable Workflows, and server-side Remote Lanes are Node-only.

### Resources, Tasks, Events, Hooks, Middleware, and Tags

Runner stays understandable because the runtime is built from a small set of definition types with explicit contracts.

> **Naming rule:** User-defined ids are local ids and must not contain `.`. Prefer `send-email` or `user-store`.

```mermaid
graph LR
    subgraph "Runner Core"
        T[Tasks] --> |use| R[Resources]
        R --> |emit| E[Events]
        E --> |trigger| H[Hooks]
        M[Middleware] --> |wrap| T
        M --> |wrap| R
        Tags --> |annotate| T
        Tags --> |annotate| R
    end

    style T fill:#4CAF50,color:#fff
    style R fill:#2196F3,color:#fff
    style E fill:#FF9800,color:#fff
    style H fill:#FF9800,color:#fff
    style M fill:#9C27B0,color:#fff
    style Tags fill:#607D8B,color:#fff
```

Use the next chapters in this order:

- **Resources**: lifecycle-owned services, config, boundaries, and ownership
- **Tasks**: typed business operations and execution-local context
- **Events & Hooks**: decoupled signaling, reactions, and emission controls
- **Middleware**: reusable policies around tasks and resources
- **Tags**: typed discovery, metadata, and framework behaviors
- **Errors**: reusable typed error helpers and declarative `.throws()` contracts

For specialized features beyond the core concepts:

- **Async Context**: per-request or thread-local state via `r.asyncContext()`
- **Durable Workflows** (Node-only): replay-safe orchestration primitives in [DURABLE_WORKFLOWS.md](../readmes/DURABLE_WORKFLOWS.md)
- **Remote Lanes** (Node): distributed events and RPC in [REMOTE_LANES.md](../readmes/REMOTE_LANES.md)
- **Serialization**: custom value transport in [SERIALIZER_PROTOCOL.md](../readmes/SERIALIZER_PROTOCOL.md)
