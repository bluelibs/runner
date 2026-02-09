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
   * Optional key to identify a shared semaphore.
   * If provided, the semaphore will be shared across all tasks using the same key.
   */
  key?: string;

  /**
   * An existing Semaphore instance to use.
   */
  semaphore?: Semaphore;
}

export interface ConcurrencyState {
  semaphoresByConfig: WeakMap<ConcurrencyMiddlewareConfig, Semaphore>;
  semaphoresByKey: Map<string, { semaphore: Semaphore; limit: number }>;
}

export const concurrencyResource = defineResource({
  id: "globals.resources.concurrency",
  tags: [globalTags.system],
  init: async () => ({
    semaphoresByConfig: new WeakMap<ConcurrencyMiddlewareConfig, Semaphore>(),
    semaphoresByKey: new Map<string, { semaphore: Semaphore; limit: number }>(),
  }),
});

/**
 * Middleware that limits concurrency of task executions using a Semaphore.
 */
export const concurrencyTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.concurrency",
  dependencies: { state: concurrencyResource },
  async run({ task, next }, { state }, config: ConcurrencyMiddlewareConfig) {
    let semaphore = config.semaphore;

    if (!semaphore && config.limit !== undefined) {
      if (config.key !== undefined) {
        const existing = state.semaphoresByKey.get(config.key);
        if (existing) {
          if (existing.limit !== config.limit) {
            throw new Error(
              `Concurrency middleware key "${config.key}" is already registered with limit ${existing.limit}, but got ${config.limit}`,
            );
          }
          semaphore = existing.semaphore;
        } else {
          semaphore = new Semaphore(config.limit);
          state.semaphoresByKey.set(config.key, {
            semaphore,
            limit: config.limit,
          });
        }
      } else {
        semaphore = state.semaphoresByConfig.get(config);
        if (!semaphore) {
          semaphore = new Semaphore(config.limit);
          state.semaphoresByConfig.set(config, semaphore);
        }
      }
    }

    if (!semaphore) {
      // If no limit or semaphore is provided, just proceed
      return next(task?.input);
    }

    return semaphore.withPermit(() => next(task?.input));
  },
});
