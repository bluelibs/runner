import { defineResource } from "../../define";
import type { Logger } from "../../models/Logger";
import { globalTags } from "../globalTags";

/**
 * The framework's structured logger.
 *
 * Inject this resource to subscribe to all log entries emitted anywhere in the
 * runtime — before they are printed to stdout — making it the right place for
 * PII scrubbing, log forwarding, or custom log routing.
 *
 * @example
 * ```ts
 * // Silence stdout and forward every log to an external API
 * const logShipper = r.resource("app.resources.logShipper")
 *   .dependencies({ logger: r.logger })
 *   .init(async ({ logger }) => {
 *     logger.onLog(async (log) => {
 *       await fetch("https://logs.example.com/ingest", {
 *         method: "POST",
 *         body: JSON.stringify(log),
 *       });
 *     });
 *   })
 *   .build();
 *
 * // Suppress console output entirely
 * await run(app, { logs: { printThreshold: null } });
 * ```
 *
 * **Log entry shape** (`ILog`):
 * - `level` — `"trace" | "debug" | "info" | "warn" | "error" | "critical"`
 * - `message` — the log message
 * - `data` — structured payload attached by the emitter
 * - `context` — bound key/value pairs (set via `logger.with(...)`)
 * - `error` — extracted error info (`name`, `message`, `stack`) when present
 * - `source` — id of the emitting component
 * - `timestamp` — `Date` of emission
 *
 * **Key behaviours:**
 * - Listeners registered via `onLog(callback)` fire *before* stdout printing;
 *   they do not suppress printing on their own — combine with
 *   `{ logs: { printThreshold: null } }` in `run()` to go fully silent.
 * - Child loggers created via `.with(...)` always delegate to the root, so a
 *   single `onLog` call captures every log regardless of source.
 * - Logs emitted during bootstrap are buffered and replayed through listeners
 *   in order at startup, so no early lifecycle logs are missed.
 * - Listener errors are caught and printed internally; they will not crash or
 *   halt the runtime.
 *
 * Shorthand: `r.logger` (alias for `r.runner.logger`).
 */
export const loggerResource = defineResource<void, Promise<Logger>>({
  id: "runner.logger",
  meta: {
    // We skip system tag for logger because it's part of the utility toolkit.
    title: "Logger",
    description:
      "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a runner.log event for each log.",
  },
  tags: [globalTags.system],
});
