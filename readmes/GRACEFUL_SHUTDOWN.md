# Graceful Shutdown & Process Hooks

← [Back to main README](../README.md) | [RunOptions section in FULL_GUIDE](./FULL_GUIDE.md#run-and-runoptions)

---

- When initialization fails, the runner now performs a rollback: it disposes every resource that was successfully initialized up to the failure point.
- Process listeners are singletons:
  - One global handler for `uncaughtException` and `unhandledRejection` that dispatches to all active runs.
  - One global handler for `SIGINT`/`SIGTERM` that dispatches to all active runs.
- Each `run()` registers/unregisters to these global dispatchers. Calling `dispose()` will:
  - Unregister the current run’s process/shutdown hook registrations
  - Dispose initialized resources (idempotent)

#### Basic usage

```ts
import { r, run } from "@bluelibs/runner";

const app = r
  .resource("app")
  .init(async () => {
    // setup root
    return "ready" as const;
  })
  .dispose(async (_value) => {
    // cleanup
  })
  .build();

const { value, dispose, taskRunner, eventManager } = await run(app, {
  // Hooks are enabled by default; set to false to disable in tests
  errorBoundary: true,
  shutdownHooks: true,
  logs: { printStrategy: "pretty", printThreshold: "info", bufferLogs: false },
});

// later
await dispose();
```

#### Rollback on init error

If any resource fails during initialization, `run()` throws and automatically disposes all previously initialized resources:

```ts
const failing = r
  .resource("failing")
  .init(async () => {
    throw new Error("boom");
  })
  .build();

const app = r
  .resource("app")
  .dependencies({ failing })
  .init(async () => {
    return "never-reached" as const;
  })
  .build();

await expect(run(app, { logs: { printStrategy: "none" } })).rejects.toThrow(
  "boom",
);
// All initialized resources before the failure were disposed.
```

#### Testing recommendations

- Prefer disabling hooks in unit tests to avoid process-level listener churn:

```ts
const { dispose } = await run(app, {
  errorBoundary: false,
  shutdownHooks: false,
  logs: { printStrategy: "none" },
});
await dispose();
```

- If you enable hooks in tests, always `await dispose()` and avoid emitting real signals. If you simulate signals, stub `process.exit`:

```ts
const originalExit = process.exit as any;
// @ts-ignore
process.exit = () => undefined as any;

const { dispose } = await run(app, { shutdownHooks: true });
process.emit("SIGINT");
await new Promise((r) => setTimeout(r, 0));
await dispose();

// @ts-ignore
process.exit = originalExit;
```

#### How it works under the hood

- A single global listener is installed per signal/type the first time any run requests it.
- Each run registers its own disposer or event manager with a global registry.
- On signal/error, the global listener fans out to active runs.
- `dispose()` unregisters this run from registries and disposes initialized resources. This is idempotent.
- `Store.dispose()` disposes only resources marked as initialized.
