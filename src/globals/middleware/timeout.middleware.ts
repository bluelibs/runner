import { defineMiddleware } from "../../define";

export interface TimeoutMiddlewareConfig {
  /**
   * Maximum time in milliseconds before the wrapped operation is aborted
   * and a timeout error is thrown. Defaults to 5000ms.
   */
  ttl: number;
}

export const timeoutMiddleware = defineMiddleware({
  id: "globals.middleware.timeout",
  async run({ task, resource, next }, _deps, config: TimeoutMiddlewareConfig) {
    const input = task ? task.input : resource?.config;

    const ttl = Math.max(0, config.ttl);
    const message = `Operation timed out after ${ttl}ms`;

    // Fast-path: immediate timeout
    if (ttl === 0) {
      const error = new Error(message);
      (error as any).name = "TimeoutError";
      throw error;
    }

    const controller = new AbortController();

    // Create a timeout promise that rejects when aborted
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        controller.abort();
        const error = new Error(message);
        (error as any).name = "TimeoutError";
        reject(error);
      }, ttl);

      // Clean up timeout if abort signal fires for other reasons
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
      });
    });

    // Race between the actual operation and the timeout
    return Promise.race([next(input), timeoutPromise]);
  },
});
