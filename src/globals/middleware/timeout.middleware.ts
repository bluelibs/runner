import { defineMiddleware } from "../../define";

export interface TimeoutMiddlewareConfig {
  /**
   * Maximum time in milliseconds before the wrapped operation is aborted
   * and a timeout error is thrown. Defaults to 5000ms.
   */
  ttl?: number;
  /** Optional custom error message */
  message?: string;
}

export const timeoutMiddleware = defineMiddleware({
  id: "globals.middleware.timeout",
  async run({ task, resource, next }, _deps, config: TimeoutMiddlewareConfig) {
    const input = task ? task.input : resource?.config;

    const ttl = Math.max(0, config?.ttl ?? 5000);
    const message = config?.message || `Operation timed out after ${ttl}ms`;

    // Fast-path: immediate timeout
    if (ttl === 0) {
      const error = new Error(message);
      (error as any).name = "TimeoutError";
      throw error;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(message);
        (error as any).name = "TimeoutError";
        reject(error);
      }, ttl);

      Promise.resolve(next(input))
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  },
});
