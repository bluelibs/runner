## 🚀 Migration Guide: From 3.x.x to 4.x.x (Extended Edition)

### 🎉 What's New & Shiny

- 🎣 **Hook system got its own apartment!** No more living with tasks - they're officially separated
- 🤫 **Invisible events with `globals.tags.excludeFromGlobalHooks`** - because sometimes events need privacy too
  - Perfect for avoiding those awkward deadlock situations when your global events get a little too chatty with side-effects
- 🏷️ **System tagging with `globals.tags.system`** - like putting a "Do Not Disturb" sign on your runner internals.
- 🎯 **Task interception powers** - resources can now be nosy neighbors to specific tasks
- 🤷‍♀️ **Optional dependencies with `.optional()`** - for when you want dependencies but they might ghost you
- 🛡️ **Result schema validation** - because trust is good, but validation is better
- 🐛 **Debug mode that won't slow you down** - zero performance impact when you're not using it
- 🛑 **Smart shutdown hooks** - they know when to bail out gracefully when things go wrong
- ⚙️ **Run options galore!** Configure `logs`, `debug`, `shutdownHooks`, and `errorBoundary` to your heart's content
- 🧯 **Centralized unhandled error handler** via `run({ onUnhandledError })` for consistent error reporting
- 🧪 **Simpler testing with `RunResult`** - `createTestResource` is deprecated; use `run()` and the returned `RunResult` helpers
- 🎭 **The Great Middleware Split of 2025** - middleware finally figured out what they want to be when they grow up
- 🏷️ **Tags got promoted!** - no more living in meta's basement, they're top-level citizens now
- 🧅 **Middleware `everywhere` is now an option, not a builder!** No more `.everywhere(...)` chaining—just use the `everywhere` property directly in your middleware definition for global application.
- 🎯 **Lifecycle hooks** Replacing lifecycle events with interception chains for precise control and zero noise

### 🏃‍♂️ Running Your App (The New Way)

We streamlined things because who doesn't love consistency?

**The old way** (works, but kinda meh):

```ts
run(app, config);
```

**The new hotness** ✨:

```ts
run(app.with(config), RunOptions);
```

### 🧪 Testing (Goodbye `createTestResource`)

We deprecated `createTestResource`. Testing is now simpler and more powerful via `run(app)`, which returns a `RunResult` exposing:

- `runTask(taskOrId, input?)`
- `emitEvent(eventOrId, payload?)`
- `getResourceValue(resourceOrId)`
- `logger`
- `dispose()`

**Before** (using `createTestResource`):

```ts
const app = resource({ id: "app", register: [db, getDbKind] });
const mockDb = override(db, { init: async () => ({ kind: "mock" }) });

const harness = createTestResource(app, { overrides: [mockDb] });
const { value: t, dispose } = await run(harness);

const kind = await t.runTask(getDbKind);
const dbValue = t.getResource("db");
await dispose();
```

**After** (using `RunResult`):

```ts
const app = resource({
  id: "app",
  register: [db, getDbKind],
  overrides: [mockDb],
});

const r = await run(app);
const kind = await r.runTask(getDbKind); // use the objects for typesafety
const dbValue = r.getResourceValue("db"); // use objects for typesafety
const emission = r.emitEvent(event, payload);
await r.dispose();
```

You can also keep overrides separate by defining a tiny test harness resource and running it directly (no helper needed):

```ts
const harness = resource({
  id: "tests.harness",
  register: [app],
  overrides: [mockDb],
});

const r = await run(harness);
// r.runTask(...), r.emitEvent(...), r.getResourceValue(...)
await r.dispose();
```

Pro tip: `RunResult` also supports string ids for convenience:

```ts
await r.runTask("t.db.kind");
await r.emitEvent("app.ping", { n: 2 });
const value = r.getResourceValue("db");
```

### 🪪 No More Anonymous Resources (Sorry, Mystery Resources!)

We're ending the witness protection program for resources. Everyone needs an ID now!

```ts
const myResource = resource({
  id: "required", // No more hiding in the shadows!
});
```

### 🤷‍♀️ Optional Dependencies

Sometimes you want a dependency, but you're not gonna throw a tantrum if it's not there. Enter optional dependencies!

```ts
const myResource = resource({
  id: "flexible-resource",
  dependencies: {
    criticalThing: someCriticalResource, // This better be there!
    niceTohave: someOptionalResource.optional(), // Meh, whatever 🤷‍♀️
  },
  init: async (_, { criticalThing, niceTohave }) => {
    // criticalThing is always there
    // niceTohave might be undefined - handle accordingly!
    if (niceTohave) {
      // Party time! 🎉
    } else {
      // No biggie, we'll make do 💪
    }
  },
});
```

### 🛡️ Result Schema Validation (Trust But Verify!)

We added result schema validation because sometimes your functions return weird stuff and you want to catch it before it breaks everything downstream.

**For tasks:**

```ts
const myTask = task({
  id: "validated-task",
  resultSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    count: z.number(),
  }), // Now your task results are bulletproof! 🛡️
  run: async (input, deps) => {
    return {
      success: true,
      data: "all good!",
      count: 42,
      // If you return something that doesn't match the schema, we'll let you know!
    };
  },
});
```

**For resources:**

```ts
const myResource = resource({
  id: "validated-resource",
  resultSchema: z.object({
    connection: z.object({
      isConnected: z.boolean(),
      url: z.string(),
    }),
  }), // Keep your resource outputs in check!
  init: async (config, deps) => {
    return {
      connection: {
        isConnected: true,
        url: "https://api.example.com",
      },
      // Schema validation happens automatically - no extra work for you! ✨
    };
  },
});
```

### ⚡ Lifecycle Events

The old system was like having too many notifications on your phone - noisy and slow. We decluttered and **BOOM!** 9x performance boost: from 250k tasks/s to 2M tasks/s! And we didn't even planned for that.

Don't worry, your middleware superpowers are still intact. Want those events back? You're the boss, hook into middleware and dispatch away!

**Want to spy on a single task?** Easy peasy:

```ts
resource({
  id: "my-resource",
  init: async (_, { taskSample }) => {
    taskSample.intercept((next, input) => {
      // Be the task whisperer 🕵️‍♀️
    });
  },
});
```

### 🎣 Listeners Got a Makeover (They're Now Hooks!)

We decided listeners deserved their own identity instead of pretending to be tasks. It's like finally getting your own Netflix account instead of using your friend's!

**Before** (the identity crisis era):

```ts
const myEvent = event({ id: "my-event" });

const myListener = task({
  id: "myListener",
  // DEPRECATED - this was confusing AF
  on: myEvent,
  listenerOrder: -100, // priority
  run: async (e, deps) => {},
});
```

**After** (hooks living their best life):

```ts
const myHook = hook({
  // Same vibes as a task, but honest about what it is
  on: myEvent,
  order: -100, // Cleaner name because we're not pretending anymore
  run: async (e, deps) => {}, // Fixed that typo while we were at it 😉
});
```

### 🎭 The Great Middleware Split of 2025

Remember when `middleware()` was trying to be everything to everyone? Like that friend who claims they're "equally good" at both singing AND dancing? Yeah, we fixed that.

**Before** (the identity crisis era):

```ts
import { middleware } from "@bluelibs/runner";

const confused = middleware({
  id: "jack-of-all-trades",
  run: async ({ task, next }) => {
    // Am I for tasks? Resources? Who knows! 🤷‍♂️
    // TypeScript is crying in the corner
  },
});
```

**After** (specialized and thriving):

```ts
import { taskMiddleware, resourceMiddleware } from "@bluelibs/runner";

const taskSpecialist = taskMiddleware({
  id: "task-whisperer",
  run: async ({ task, next }, deps, config) => {
    // I know EXACTLY what I am! task.input, task.id, task.definition
    // TypeScript is doing a happy dance 💃
  },
});

const resourceSpecialist = resourceMiddleware({
  id: "resource-guardian",
  run: async ({ resource, next }, deps, config) => {
    // resource.id, resource.config, resource.definition
    // Living my best specialized life! ✨
  },
});
```

### 🧅 Middleware: `everywhere` is now an option, not a builder

Previously, you could use the builder pattern to apply middleware everywhere, like this:

```ts
const globalTaskMiddleware = taskMiddleware({ id: "..." }).everywhere(
  (task) => true,
);
```

**Now:**  
The `everywhere` property is a direct option on the middleware definition object:

```ts
const globalTaskMiddleware = taskMiddleware({
  id: "...",
  everywhere: true, // or a function: (task) => boolean
  // ...rest as usual
});
```

This change makes the API more consistent and type-safe. Update your middleware definitions accordingly.

### 🏷️ Tags Got Promoted! (No More Living in Meta's Basement)

Tags were tired of being buried in `meta.tags`. They've moved out of their parent's basement and got their own apartment!

**Before** (tags living under meta's roof):

```ts
const myTask = task({
  id: "shy-task",
  meta: {
    title: "My Task",
    description: "Does stuff",
    tags: ["billing", perf.with({ warnAboveMs: 1000 })], // Hidden away like a teenager
  },
  run: async () => {},
});

const myResource = resource({
  id: "nested-resource",
  meta: {
    tags: [globals.tags.system], // Why so deep? 🕳️
  },
  init: async () => ({}),
});
```

**After** (tags standing proud at the top level):

```ts
const myTask = task({
  id: "confident-task",
  tags: ["billing", perf.with({ warnAboveMs: 1000 })], // BOOM! Right there! 💪
  meta: {
    title: "My Task", // Meta is now just for documentation
    description: "Does stuff", // Not for behavior!
  },
  run: async () => {},
});

const myResource = resource({
  id: "toplevel-resource",
  tags: [globals.tags.system], // First-class citizen! 🎩
  meta: {
    // Meta is now purely informational, like a business card
    title: "My Resource",
    author: "Probably you",
  },
  init: async () => ({}),
});
```

**Why we did this:**

- Tags affect behavior (contracts, interception, discovery)
- Meta is just... metadata (documentation, descriptions, your favorite color)
- Separating church and state, but for code! ⛪️🏛️

**Tag extraction got easier too:**

```ts
// Before (digging through meta)
const cfg = perf.extract(task.definition.meta?.tags);

// After (right there on top!)
const cfg = perf.extract(task.definition.tags);
// or if you already have the tags
const cfg = perf.extract(tags);
```

### 📝 Logger Got VIP Treatment (No More Event Bus Drama!)

Logger was tired of competing for attention on the event bus. We gave it the special treatment it deserves, now it's got its own direct line!

**Simple logging setup:**

```ts
run(app, {
  logs: {
    printThreshold: "info", // default, or null if you want radio silence
    printStrategy: "pretty" | "json" | "json-pretty" | "plain", // pick your poison
  },
});
```

**Want to add your own logging magic?** Hook right into it:

```ts
const logsExtension = resource({
  dependencies: {
    logger: globals.resources.logger,
  },
  init: async (_, { logger }) => {
    logger.onLog((log) => {
      // Do whatever your heart desires with the ILog interface! 💫
    });
  },
});
// Just register this bad boy and you're golden ✨
```

### 🎣 Gotta Catch 'Em All (Error Edition!)

We unified error catching behind a single, centralized handler. Instead of relying on framework error events, use `run({ onUnhandledError })`.

```ts
await run(app, {
  errorBoundary: true, // installs uncaughtException & unhandledRejection handlers on process
  onUnhandledError: async ({ error, kind, source }) => {
    // kind: "task" | "middleware" | "resourceInit" | "hook" | "process" | "run"
    // source: optional origin hint (ex: "uncaughtException")
    await telemetry.capture(error as Error, { kind, source });
  },
});
```

If you prefer event-driven handling, define your own event and emit it from this callback.

### 🐛 Debug Mode: Now With 0% Performance Guilt!

We built a debug system so good, it won't slow you down when you're not using it. It's like having a personal detective that only shows up when invited!

**Basic debug setup:**

```ts
run(app, {
  // Only activates when you need it - no performance tax!
  debug: "normal" | "verbose" | DebugConfig,
});
```

**Want to get fancy with specific components?**

```ts
resource({
  // ...
  meta: {
    tags: {
      // Mix and match debug levels like a DJ mixing tracks 🎧
      global.tags.debug.with("verbose"), // or "normal" or full DebugConfig
    }
  }
})
```

**Normal vs Verbose:** Normal gives you the play-by-play, verbose gives you the director's commentary with all the input/output data!

**Feeling overwhelmed?** Take the wheel with full control:

```ts
export type DebugConfig = {
  logResourceConfig: boolean;
  logResourceValue: boolean;
  logResourceBeforeRun: boolean;
  logResourceAfterRun: boolean;
  logResourceOnError: boolean;
  logTaskBeforeRun: boolean;
  logTaskInput: boolean;
  logTaskOutput: boolean;
  logTaskAfterRun: boolean;
  logTaskOnError: boolean;
  logMiddlewareBeforeRun: boolean;
  logMiddlewareAfterRun: boolean;
  logMiddlewareOnError: boolean;
  logEventEmissionOnRun: boolean;
  logEventEmissionInput: boolean;
  logHookTriggered: boolean;
  logHookCompleted: boolean;
};
// It's like having 17 different volume knobs for your debugging orchestra! 🎼
```

### 🧵 Interception APIs

Runner replaces hook/middleware lifecycle events with interception chains for precise control and zero noise:

- `eventManager.intercept((next, event) => Promise<void>)` — intercept event emission
- `eventManager.interceptHook((next, hook, event) => Promise<any>)` — intercept hook execution
- `middlewareManager.intercept("task" | "resource", (next, input) => Promise<any>)` — intercept middleware execution
- `middlewareManager.interceptMiddleware(middleware, interceptor)` — per-middleware interception

Use these for observability, tracing, or policy enforcement. Prefer `task.intercept()` for app-level behavior.

### 🏷️ Type Contracts for Middleware and Tags

We've enhanced the type system to support stronger contracts:

**Middleware Type Contracts:**

```ts
// Middleware now supports <Config, Input, Output> type contracts
const authMiddleware = taskMiddleware<
  { role: string }, // Config
  { user: { role: string } }, // Input type enforcement
  { user: { role: string; verified: boolean } } // Output type enforcement
>({
  id: "app.middleware.auth",
  run: async ({ task, next }, _, config) => {
    if (task.input.user.role !== config.role) {
      throw new Error("Unauthorized");
    }
    const result = await next(task.input);
    return { user: { ...task.input.user, verified: true } };
  },
});

// Resource middleware follows the same pattern
const resourceMiddleware = resourceMiddleware<Config, Input, Output>({
  // ...
});
```

**Tag Contracts:**

```ts
// Tags now use <Config, Unused, Output> for return type enforcement
const userContract = tag<void, void, { name: string }>({ id: "contract.user" });
const ageContract = tag<void, void, { age: number }>({ id: "contract.age" });

// Tasks must return data matching all tag contracts
const getProfile = task({
  id: "app.tasks.getProfile",
  tags: [userContract, ageContract],
  run: async () => ({ name: "Ada", age: 37 }), // Must satisfy both contracts
});
```

**Migration:** Update existing middleware and tags to use the new type parameters for stronger type safety.
