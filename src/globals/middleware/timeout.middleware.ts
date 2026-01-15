import { defineTaskMiddleware, defineResourceMiddleware } from "../../define";

export interface TimeoutMiddlewareConfig {
  /**
   * Maximum time in milliseconds before the wrapped operation is aborted
   * and a timeout error is thrown. Defaults to 5000ms.
   */
  ttl: number;
}

/**
 * Custom error class for timeout errors.
 * Using a class allows proper instanceof checks and avoids `as any` casts.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export const timeoutTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.timeout.task",
  async run({ task, next }, _deps, config: TimeoutMiddlewareConfig) {
    const input = task?.input;

    const ttl = Math.max(0, config.ttl);
    const message = `Operation timed out after ${ttl}ms`;

    // Fast-path: immediate timeout
    if (ttl === 0) {
      throw new TimeoutError(message);
    }

    const controller = new AbortController();

    // Create a timeout promise that rejects when aborted
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(message));
      }, ttl);

      // Clean up timeout if abort signal fires for other reasons
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
      });
    });

    // Race between the actual operation and the timeout
    return Promise.race([next(input as any), timeoutPromise]);
  },
});

export const timeoutResourceMiddleware = defineResourceMiddleware({
  id: "globals.middleware.timeout.resource",
  async run({ resource, next }, _deps, config: TimeoutMiddlewareConfig) {
    const input = resource?.config;
    const ttl = Math.max(0, config.ttl);
    const message = `Operation timed out after ${ttl}ms`;
    if (ttl === 0) {
      throw new TimeoutError(message);
    }
    const controller = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(message));
      }, ttl);
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
      });
    });
    return Promise.race([next(input as any), timeoutPromise]);
  },
});
