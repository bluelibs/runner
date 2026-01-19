import { defineTaskMiddleware, defineResource } from "../../define";
import { Semaphore } from "../../models/Semaphore";
import { globalTags } from "../globalTags";

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

export interface ConcurrencyState {
  semaphores: WeakMap<ConcurrencyMiddlewareConfig, Semaphore>;
}

export const concurrencyResource = defineResource({
  id: "globals.resources.concurrency",
  tags: [globalTags.system],
  init: async () => ({
    semaphores: new WeakMap<ConcurrencyMiddlewareConfig, Semaphore>(),
  }),
});

/**
 * Middleware that limits concurrency of task executions using a Semaphore.
 */
export const concurrencyTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.concurrency",
  dependencies: { state: concurrencyResource },
  async run({ task, next }, { state }, config: ConcurrencyMiddlewareConfig) {
    let semaphore = config.semaphore;

    if (!semaphore && config.limit !== undefined) {
      const { semaphores } = state;
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
