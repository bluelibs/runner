## 🚀 Migration Guide: From 3.x.x to 4.x.x

### 🎉 What's New & Shiny

- 🎣 **Hook system got its own apartment!** No more living with tasks - they're officially separated
- 🤫 **Invisible events with `globals.tags.excludeFromGlobalListeners`** - because sometimes events need privacy too
  - Perfect for avoiding those awkward deadlock situations when your global events get a little too chatty with side-effects
- 🏷️ **System tagging with `globals.tags.system`** - like putting a "Do Not Disturb" sign on your runner internals
- 🎯 **Task interception powers** - resources can now be nosy neighbors to specific tasks
- 🤷‍♀️ **Optional dependencies with `.optional()`** - for when you want dependencies but they might ghost you
- 🛡️ **Result schema validation** - because trust is good, but validation is better
- 🐛 **Debug mode that won't slow you down** - zero performance impact when you're not using it
- 🛑 **Smart shutdown hooks** - they know when to bail out gracefully when things go wrong
- ⚙️ **Run options galore!** Configure `logs`, `debug`, `shutdownHooks`, and `errorBoundary` to your heart's content
- 👀 **Observability superpowers** for middleware and hooks:
  - global.events.hookTriggered
  - global.events.hookCompleted
  - global.events.middlewareTriggered
  - global.events.middlewareCompleted

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

### 📝 Logger Got VIP Treatment (No More Event Bus Drama!)

Logger was tired of competing for attention on the event bus. We gave it the special treatment it deserves, now it's got its own direct line!

**Simple logging setup:**

```ts
run(app, {
  logs: {
    printThreshold: "info", // default, or null if you want radio silence
    printStrategy: "pretty" | "json" | "json-pretty", // pick your poison
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

We unified error catching because who wants to remember multiple event names? One hook to rule them all!

```ts
hook({
  id: "pokemon.catch-em.all", // 10/10 naming, no notes
  on: globals.events.unhandledError,
  dependencies: {},
  init: async (e, deps) => {
    const unhandledError = e.data;
    // kind: "task" | "middleware" | "resourceInit" | "hook" | "process"
    // Basically, if it crashed, you'll know about it! 💥
  },
});
```

**Pro tip:** This error is too cool for global listeners ("\*") - it's got that exclusion tag swagger! 😎

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
