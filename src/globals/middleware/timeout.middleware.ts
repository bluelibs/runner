import { defineResourceMiddleware } from "../../definers/defineResourceMiddleware";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { journal } from "../../models/ExecutionJournal";
import { RunnerError } from "../../definers/defineError";
import { middlewareTimeoutError, RunnerErrorId } from "../../errors";
import { Match } from "../../tools/check";
import { symbolDefinitionIdentity } from "../../types/symbols";

enum AbortSignalEventType {
  Abort = "abort",
}

export interface TimeoutMiddlewareConfig {
  /**
   * Maximum time in milliseconds before the wrapped operation is aborted
   * and a timeout error is thrown. Defaults to 5000ms.
   */
  ttl?: number;
}

const timeoutConfigPattern = Match.ObjectIncluding({
  ttl: Match.Optional(Match.PositiveInteger),
});

/**
 * Custom error class for timeout errors.
 * Using a class allows proper instanceof checks.
 */
export class TimeoutError extends RunnerError<{ message: string }> {
  constructor(message: string) {
    super(
      RunnerErrorId.MiddlewareTimeout,
      message,
      { message },
      middlewareTimeoutError.httpCode,
      undefined,
      middlewareTimeoutError[symbolDefinitionIdentity],
    );
  }
}

/**
 * Journal keys exposed by the timeout middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** The AbortController created by the timeout middleware */
  abortController: journal.createKey<AbortController>(
    "runner.middleware.timeout.abortController",
  ),
} as const;

export const timeoutTaskMiddleware = defineTaskMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.timeout.task",
    throws: [middlewareTimeoutError],
    configSchema: timeoutConfigPattern,
    async run({ task, next, journal }, _deps, config: TimeoutMiddlewareConfig) {
      const input = task?.input;

      const ttl = Math.max(0, config.ttl ?? 5000);
      const message = `Operation timed out after ${ttl}ms`;
      const timeoutError = new TimeoutError(message);

      // Fast-path: immediate timeout
      if (ttl === 0) {
        throw timeoutError;
      }

      const existingController = journal.get(journalKeys.abortController);
      const controller = existingController ?? new AbortController();

      if (!existingController) {
        // Expose controller for downstream middleware/tasks
        journal.set(journalKeys.abortController, controller);
      }

      return await new Promise((resolve, reject) => {
        let settled = false;

        const abortHandler = () => settle("reject", timeoutError);

        const settle = (kind: "resolve" | "reject", value?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          controller.signal.removeEventListener(
            AbortSignalEventType.Abort,
            abortHandler,
          );
          if (kind === "resolve") {
            resolve(value);
          } else {
            reject(value);
          }
        };

        const timeoutId = setTimeout(() => {
          controller.abort();
          settle("reject", timeoutError);
        }, ttl);

        controller.signal.addEventListener(
          AbortSignalEventType.Abort,
          abortHandler,
        );

        const finish = (cb: () => Promise<unknown>) => {
          cb().then(
            (result) => settle("resolve", result),
            (error) => settle("reject", error),
          );
        };

        finish(() => next(input as unknown));
      });
    },
  }),
);

export const timeoutResourceMiddleware = defineResourceMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.timeout.resource",
    throws: [middlewareTimeoutError],
    configSchema: timeoutConfigPattern,
    async run({ resource, next }, _deps, config: TimeoutMiddlewareConfig) {
      const input = resource?.config;
      const ttl = Math.max(0, config.ttl ?? 5000);
      const message = `Operation timed out after ${ttl}ms`;
      const timeoutError = new TimeoutError(message);
      if (ttl === 0) {
        throw timeoutError;
      }
      const controller = new AbortController();
      return await new Promise((resolve, reject) => {
        let settled = false;

        const abortHandler = () => settle("reject", timeoutError);

        const settle = (kind: "resolve" | "reject", value?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          controller.signal.removeEventListener(
            AbortSignalEventType.Abort,
            abortHandler,
          );
          if (kind === "resolve") {
            resolve(value);
          } else {
            reject(value);
          }
        };

        const timeoutId = setTimeout(() => {
          controller.abort();
          settle("reject", timeoutError);
        }, ttl);

        controller.signal.addEventListener(
          AbortSignalEventType.Abort,
          abortHandler,
        );

        const finish = (cb: () => Promise<unknown>) => {
          cb().then(
            (result) => settle("resolve", result),
            (error) => settle("reject", error),
          );
        };

        finish(() => next(input as unknown));
      });
    },
  }),
);
