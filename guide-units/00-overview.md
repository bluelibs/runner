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

const app = r
  .resource("app")
  .register([userStore, createUser])
  .build();

const { runTask, dispose } = await run(app);

console.log(await runTask(createUser, { email: "ada@example.com" }));
await dispose();
```

**What this proves**: the smallest Runner app still has explicit wiring, a runtime boundary, and reusable units.

### Starter Map

Use this instead of scanning the whole guide first:

- [Your First 5 Minutes](#your-first-5-minutes) - shortest path to a working runtime
- [What Is This Thing?](#what-is-this-thing) - the mental model
- [Quick Wins](#quick-wins-pressure-tested-recipes) - production recipes you can paste
- [How Does It Compare?](#how-does-it-compare) - where Runner fits
- [Tasks](#tasks) - core execution unit
- [Resources](#resources) - shared state and lifecycle
- [Testing](#testing) - unit vs runtime execution
- [Multi-Platform Architecture](./readmes/MULTI_PLATFORM.md) - Node, browser, and edge boundaries

### Why It Appeals to Senior TypeScript Teams

- **Explicit wiring**: dependencies are declared in code, not discovered at runtime
- **Honest execution boundaries**: call `.run()` for isolated unit tests or `runTask()` for the full runtime path
- **Lifecycle as a first-class concern**: startup and shutdown live with the resource, not in scattered bootstrap code
- **Incremental adoption**: wrap one service or one task before deciding whether to expand
- **Traceability**: ids, logs, and runtime behavior stay aligned with source code

### Tradeoffs and Boundaries

Runner is not trying to be the lowest-ceremony option for tiny scripts.

- You write some setup code up front so the graph stays explicit later.
- The best payoff appears once your app has multiple long-lived services or cross-cutting policies.
- Some features are intentionally platform-specific.
  Async Context, Durable Workflows, and server-side Remote Lanes are Node-only.

**Next step**: go to [Your First 5 Minutes](#your-first-5-minutes) if you want the fastest proof, or [How Does It Compare?](#how-does-it-compare) if you are still evaluating alternatives.
