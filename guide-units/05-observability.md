## Observability Strategy (Logs, Metrics, and Traces)

Runner gives you primitives for all three observability signals:

- **Logs**: structured application/runtime events via `resources.logger`
- **Metrics**: numeric health and performance indicators from your resources/tasks/middleware
- **Traces**: distributed timing and call-path correlation using your tracing stack (for example OpenTelemetry)

Use all three together. Logs explain what happened, metrics tell you when it is happening repeatedly, and traces show where latency accumulates.
Runner provides the integration points (interceptors, context propagation, structured logs), while tracer backends are installed and configured by your application.

For resource-level operational status, Runner also supports optional async `resource.health(...)` probes and aggregates them through `resources.health.getHealth(...)` and `runtime.getHealth(...)`. Only resources that explicitly opt in are counted, and sleeping lazy resources are skipped, which keeps the report aligned with the checks you actually trust.

### Naming conventions

Keep names stable and low-cardinality:

- **Metric names**: `{domain}_{unit}` or `{domain}_{action}_{unit}` (for example: `tasks_duration_ms`, `queue_wait_ms`, `http_requests_total`)
- **Metric labels**: prefer bounded values (`task_id`, `result`, `env`), avoid user ids/emails/request bodies
- **Trace spans**: `{component}:{operation}` (for example: `task:app.tasks.createUser`, `resource:app.db.init`)
- **Log source**: always include a stable `source` (task/resource id)

### Baseline production dashboard

At minimum, chart these for every service:

- Request/task throughput (`requests_total`, `tasks_total`)
- Error rate (`requests_failed_total` / `tasks_failed_total`)
- Latency percentiles (`p50`, `p95`, `p99`)
- Resource saturation (queue depth, semaphore utilization, event-loop lag)
- Dependency health (database/cache/external API failure and latency)

### Baseline alerts

Start with practical, non-noisy alerts:

- Error rate above threshold for 5+ minutes
- P95 latency above SLO for 10+ minutes
- No successful requests/tasks for a critical service window
- Dependency outage (consecutive failures crossing a threshold)
- Event-loop lag sustained above operational limit

### Correlation checklist

For incident response, ensure each signal can be joined:

- Emit `requestId` / `correlationId` in logs
- Attach task/resource ids to spans and logs
- Keep metric labels aligned with the same service/component ids

---

## Logging

_Structured logging with predictable shape and pluggable transports_

Runner ships a structured logger with consistent fields, onLog hooks, and multiple print strategies so you can pipe logs to consoles or external transports without custom glue.

### Basic Logging

```typescript
import { r } from "@bluelibs/runner";

const app = r
  .resource("app")
  .dependencies({ logger: resources.logger })
  .init(async (_config, { logger }) => {
    logger.info("Starting business process"); //  Visible by default
    logger.warn("This might take a while"); //  Visible by default
    logger.error("Oops, something went wrong", {
      //  Visible by default
      error: new Error("Database connection failed"),
    });
    logger.critical("System is on fire", {
      //  Visible by default
      data: { temperature: "9000°C" },
    });
    logger.debug("Debug information"); //  Hidden by default
    logger.trace("Very detailed trace"); //  Hidden by default

    logger.onLog(async (log) => {
      // Sub-loggers instantiated .with() share the same log callbacks.
      // Catch logs
    });
  })
  .build();

run(app, {
  logs: {
    printThreshold: "info", // use null to disable printing, and hook into onLog(), if in 'test' mode default is null unless specified
    printStrategy: "pretty", // you also have "plain", "json" and "json-pretty" with circular dep safety for JSON formatting.
    bufferLogs: false, // Starts sending out logs only after the system emits the ready event. Useful for when you're sending them out.
  },
});
```

### Log Levels

The logger supports six log levels with increasing severity:

| Level      | Severity | When to Use                                 | Color   |
| ---------- | -------- | ------------------------------------------- | ------- |
| `trace`    | 0        | Ultra-detailed debugging info               | Gray    |
| `debug`    | 1        | Development and debugging information       | Cyan    |
| `info`     | 2        | General information about normal operations | Green   |
| `warn`     | 3        | Something's not right, but still working    | Yellow  |
| `error`    | 4        | Errors that need attention                  | Red     |
| `critical` | 5        | System-threatening issues                   | Magenta |

```typescript
// All log levels are available as methods
logger.trace("Ultra-detailed debugging info");
logger.debug("Development debugging");
logger.info("Normal operation");
logger.warn("Something's fishy");
logger.error("Houston, we have a problem");
logger.critical("DEFCON 1: Everything is broken");
```

### Structured Logging

The logger accepts rich, structured data that makes debugging actually useful:

```typescript
const userTask = r
  .task("createUser")
  .dependencies({ logger: resources.logger })
  .run(async (input, { logger }) => {
    // Basic message
    logger.info("Creating new user");

    // With structured data
    logger.info("User creation attempt", {
      source: userTask.id,
      data: {
        email: input.email,
        registrationSource: "web",
        timestamp: new Date().toISOString(),
      },
    });

    // With error information
    try {
      // Replace with your own persistence/service call
      const user = await Promise.resolve({
        id: "user-1",
        email: input.email,
      });
      logger.info("User created successfully", {
        data: { userId: user.id, email: user.email },
      });
    } catch (error) {
      const safeError =
        error instanceof Error ? error : new Error(String(error));

      logger.error("User creation failed", {
        error: safeError,
        data: {
          attemptedEmail: input.email,
        },
      });
    }
  })
  .build();
```

### Add Structured Logging Early

When production visibility is weak, structured task logging is usually the first policy worth adding.

```typescript
import { resources, r } from "@bluelibs/runner";

const chargeCard = async (input: { orderId: string; amount: number }) => ({
  id: `txn:${input.orderId}`,
});

const processPayment = r
  .task("processPayment")
  .dependencies({ logger: resources.logger })
  .run(async (input: { orderId: string; amount: number }, { logger }) => {
    await logger.info("Processing payment", {
      data: { orderId: input.orderId, amount: input.amount },
    });

    try {
      const result = await chargeCard(input);
      await logger.info("Payment successful", {
        data: { transactionId: result.id },
      });
      return result;
    } catch (error) {
      await logger.error("Payment failed", {
        error,
        data: { orderId: input.orderId, amount: input.amount },
      });
      throw error;
    }
  })
  .build();
```

This keeps operational context close to the business action without inventing ad hoc logging conventions per task.

### Context-Aware Logging

Create logger instances with bound context for consistent metadata across related operations:

```typescript
const RequestContext = r
  .asyncContext<{ requestId: string; userId: string }>("request")
  .build();

const requestHandler = r
  .task("handleRequest")
  .dependencies({ logger: resources.logger })
  .run(async (requestData, { logger }) => {
    const request = RequestContext.use();

    // Create a contextual logger with bound metadata with source and context
    const requestLogger = logger.with({
      // Logger already comes with the source set. You can override it or add more context as needed.
      source: requestHandler.id,
      additionalContext: {
        requestId: request.requestId,
        userId: request.userId,
      },
    });

    // All logs from this logger will include the bound context
    requestLogger.info("Processing request", {
      data: { endpoint: requestData.path },
    });

    requestLogger.debug("Validating input", {
      data: { inputSize: JSON.stringify(requestData).length },
    });

    // Context is automatically included in all log events
    requestLogger.error("Request processing failed", {
      error: new Error("Invalid input"),
      data: { stage: "validation" },
    });
  })
  .build();
```

### Integration with Winston

Want to use Winston as your transport? No problem - integrate it seamlessly:

```typescript
import winston from "winston";
import { r } from "@bluelibs/runner";

// Create Winston logger, put it in a resource if used from various places.
const winstonLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Bridge BlueLibs logs to Winston using hooks
const winstonBridgeResource = r
  .resource("winstonBridge")
  .dependencies({ logger: resources.logger })
  .init(async (_config, { logger }) => {
    // Map log levels (BlueLibs -> Winston)
    const levelMapping = {
      trace: "silly",
      debug: "debug",
      info: "info",
      warn: "warn",
      error: "error",
      critical: "error", // Winston doesn't have critical, use error
    };

    logger.onLog((log) => {
      // Convert Runner log to Winston format
      const winstonMeta = {
        source: log.source,
        timestamp: log.timestamp,
        data: log.data,
        context: log.context,
        ...(log.error && { error: log.error }),
      };

      const winstonLevel = levelMapping[log.level] || "info";
      winstonLogger.log(winstonLevel, log.message, winstonMeta);
    });
  })
  .build();
```

### Custom Log Formatters

Want to customize how logs are printed? You can override the print behavior:

```typescript
// Custom logger with JSON output
class JSONLogger extends Logger {
  print(log: ILog) {
    console.log(
      JSON.stringify(
        {
          timestamp: log.timestamp.toISOString(),
          level: log.level.toUpperCase(),
          source: log.source,
          message: log.message,
          data: log.data,
          context: log.context,
          error: log.error,
        },
        null,
        2,
      ),
    );
  }
}

// Custom logger resource
const customLogger = r
  .resource("customLogger")
  .init(
    async () =>
      new JSONLogger({
        printThreshold: "info",
        printStrategy: "json",
        bufferLogs: false,
      }),
  )
  .build();

// Or you could simply add it as "resources.logger" and override the default logger
```

### Log Structure

Every log event contains:

```typescript
interface ILog {
  level: LogLevels; // "trace" | "debug" | "info" | "warn" | "error" | "critical"
  source?: string; // Where the log came from
  message: unknown; // The main log message (can be object or string)
  timestamp: Date; // When the log was created
  error?: {
    // Structured error information
    name: string;
    message: string;
    stack?: string;
  };
  data?: Record<string, unknown>; // Additional structured data, it's about the log itself
  context?: Record<string, unknown>; // Bound context from logger.with(), it's about the context in which the log was created
}
```

## Debug Resource

_Debug hooks for tasks, resources, and events without shipping extra overhead when disabled_

The Debug Resource instruments the execution pipeline so you can trace task/resource lifecycle, inputs/outputs, and events. When not registered it stays out of the hot path; when enabled you can pick exactly which signals to record.

### Quick Start with Debug

```typescript
run(app, { debug: "verbose" });
```

### Debug Levels

**"normal"** - Balanced visibility for development:

- Task and resource lifecycle events
- Event emissions
- Hook executions
- Error tracking
- Performance timing data

**"verbose"** - Detailed visibility for deep debugging:

- All "normal" features plus:
- Task input/output logging
- Resource configuration and results

**Custom Configuration**:

```typescript
import { r } from "@bluelibs/runner";

const app = r
  .resource("app")
  .register([
    resources.debug.with({
      logTaskInput: true,
      logTaskOutput: false,
      logResourceConfig: true,
      logResourceValue: false,
      logEventEmissionOnRun: true,
      logEventEmissionInput: false,
      // ... other fine-grained options
    }),
  ])
  .build();
```

### Accessing Debug Levels Programmatically

The debug configuration levels can be accessed via `debug.levels`:

```typescript
import { r } from "@bluelibs/runner";

// Use in custom configurations
const customConfig = {
  ...debug.levels.normal, // or .verbose
  logTaskInput: true, // Override specific settings
};

// Register with custom configuration
const app = r
  .resource("app")
  .register([resources.debug.with(customConfig)])
  .build();
```

### Per-Component Debug Configuration

Use debug tags to configure debugging on individual components, when you're interested in just a few verbose ones.

```typescript
import { r } from "@bluelibs/runner";

const criticalTask = r
  .task("critical")
  .tags([tags.debug.with("verbose")])
  .run(async (input) => {
    // This task will have verbose debug logging
    return await processPayment(input);
  })
  .build();
```

### Integration with Run Options

```typescript
import { run } from "@bluelibs/runner";

// Debug options at startup
const { store, dispose } = await run(app, {
  debug: "verbose", // Enable debug globally
});

// Access the runtime store for introspection
console.log(`Tasks registered: ${store.tasks.size}`);
console.log(`Events registered: ${store.events.size}`);
```

### Performance Impact

The debug resource is designed for zero production overhead:

- **Disabled**: No performance impact whatsoever
- **Enabled**: Minimal overhead (~0.1ms per operation)
- **Filtering**: System components are automatically excluded from debug logs
- **Buffering**: Logs are batched for better performance

### Debugging Tips & Best Practices

Use Structured Data Liberally

```typescript
// Bad - hard to search and filter
await logger.error(`Failed to process user ${userId} order ${orderId}`);

// Good - searchable and filterable
await logger.error("Order processing failed", {
  data: {
    userId,
    orderId,
    step: "payment",
    paymentMethod: "credit_card",
  },
});
```

Include Context in Errors

```typescript
// Include relevant context with errors
try {
  await processPayment(order);
} catch (error) {
  await logger.error("Payment processing failed", {
    error,
    data: {
      orderId: order.id,
      amount: order.total,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      attemptNumber: order.paymentAttempts,
    },
  });
}
```

Use Different Log Levels Appropriately

```typescript
// Good level usage
await logger.debug("Cache hit", { data: { key, ttl: remainingTTL } });
await logger.info("User logged in", { data: { userId, loginMethod } });
await logger.warn("Rate limit approaching", {
  data: { current: 95, limit: 100 },
});
await logger.error("Database connection failed", {
  error,
  data: { attempt: 3 },
});
await logger.critical("System out of memory", { data: { available: "0MB" } });
```

Create Domain-Specific Loggers

```typescript
// Create loggers with domain context
const paymentLogger = logger.with({ source: "payment.processor" });
const authLogger = logger.with({ source: "auth.service" });
const emailLogger = logger.with({ source: "email.service" });

// Use throughout your domain
await paymentLogger.info("Processing payment", { data: paymentData });
await authLogger.warn("Failed login attempt", { data: { email, ip } });
```

> **runtime:** "'Zero‑overhead when disabled.' Groundbreaking—like a lightbulb that uses no power when it's off. Flip to `debug: 'verbose'` and behold a 4K documentary of your mistakes, narrated by your stack traces."
