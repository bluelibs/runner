## System Shutdown Hooks

 Hooks

_Graceful shutdown and cleanup when your app needs to stop_

The framework includes built-in support for graceful shutdowns with automatic cleanup and configurable shutdown hooks:

```typescript
import { run } from "@bluelibs/runner";

// Enable shutdown hooks (default: true in production)
const { dispose, taskRunner, eventManager } = await run(app, {
  shutdownHooks: true, // Automatically handle SIGTERM/SIGINT
  errorBoundary: true, // Catch unhandled errors and rejections
});

// Manual graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  await dispose(); // This calls all resource dispose() methods
  process.exit(0);
});

// Resources with cleanup logic
const databaseResource = r
  .resource("app.database")
  .init(async () => {
    const connection = await connectToDatabase();
    console.log("Database connected");
    return connection;
  })
  .dispose(async (connection) => {
    await connection.close();
    // console.log("Database connection closed");
  })
  .build();

const serverResource = r
  .resource("app.server")
  .dependencies({ database: databaseResource })
  .init(async (config: { port: number }, { database }) => {
    const server = express().listen(config.port);
    console.log(`Server listening on port ${config.port}`);
    return server;
  })
  .dispose(async (server) => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        console.log("Server closed");
        resolve();
      });
    });
  })
  .build();
```

### Error Boundary Integration

The framework can automatically handle uncaught exceptions and unhandled rejections:

```typescript
const { dispose, logger } = await run(app, {
  errorBoundary: true, // Catch process-level errors
  shutdownHooks: true, // Graceful shutdown on signals
  onUnhandledError: async ({ error, kind, source }) => {
    // We log it by default
    await logger.error(`Unhandled error: ${error && error.toString()}`);
    // Optionally report to telemetry or decide to dispose/exit
  },
});
```

> **runtime:** "You summon a 'graceful shutdown' with Ctrl‑C like a wizard casting Chill Vibes. Meanwhile I’m speed‑dating every socket, timer, and file handle to say goodbye before the OS pulls the plug. `dispose()`: now with 30% more dignity."

## Unhandled Errors

The `onUnhandledError` callback is invoked by Runner whenever an error escapes normal handling. It receives a structured payload you can ship to logging/telemetry and decide mitigation steps.

```typescript
type UnhandledErrorKind =
  | "process" // uncaughtException / unhandledRejection
  | "task" // task.run threw and wasn't handled
  | "middleware" // middleware threw and wasn't handled
  | "resourceInit" // resource init failed
  | "hook" // hook.run threw and wasn't handled
  | "run"; // failures in run() lifecycle

interface OnUnhandledErrorInfo {
  error: unknown;
  kind?: UnhandledErrorKind;
  source?: string; // additional origin hint (ex: "uncaughtException")
}

type OnUnhandledError = (info: OnUnhandledErrorInfo) => void | Promise<void>;
```

Default behavior (when not provided) logs the normalized error via the created `logger` at `error` level. Provide your own handler to integrate with tools like Sentry/PagerDuty or to trigger shutdown strategies.

Example with telemetry and conditional shutdown:

```typescript
await run(app, {
  errorBoundary: true,
  onUnhandledError: async ({ error, kind, source }) => {
    await telemetry.capture(error as Error, { kind, source });
    // Optionally decide on remediation strategy
    if (kind === "process") {
      // For hard process faults, prefer fast, clean exit after flushing logs
      await flushAll();
      process.exit(1);
    }
  },
});
```

**Best Practices for Shutdown:**

- Resources are disposed in reverse dependency order
- Set reasonable timeouts for cleanup operations
- Save critical state before shutdown
- Notify load balancers and health checks
- Stop accepting new work before cleaning up

> **runtime:** "An error boundary: a trampoline under your tightrope. I’m the one bouncing, cataloging mid‑air exceptions, and deciding whether to end the show or juggle chainsaws with a smile. The audience hears music; I hear stack traces."

