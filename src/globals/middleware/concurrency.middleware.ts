import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { Semaphore } from "../../models/Semaphore";

export interface ConcurrencyMiddlewareConfig {
  /**
   * Maximum number of concurrent executions.
   * If provided, a Semaphore will be created and shared for this config object.
   */
  limit?: number;

  /**
   * An existing Semaphore instance to use.
   */
  semaphore?: Semaphore;
}

const semaphores = new WeakMap<ConcurrencyMiddlewareConfig, Semaphore>();

/**
 * Middleware that limits concurrency of task executions using a Semaphore.
 */
export const concurrencyTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.concurrency",
  async run({ task, next }, _deps, config: ConcurrencyMiddlewareConfig) {
    let semaphore = config.semaphore;

    if (!semaphore && config.limit !== undefined) {
      semaphore = semaphores.get(config);
      if (!semaphore) {
        semaphore = new Semaphore(config.limit);
        semaphores.set(config, semaphore);
      }
    }

    if (!semaphore) {
      // If no limit or semaphore is provided, just proceed
      return next(task?.input);
    }

    return semaphore.withPermit(() => next(task?.input));
  },
});
