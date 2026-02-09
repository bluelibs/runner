import { defineResource, defineTaskMiddleware } from "../../define";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalTags } from "../globalTags";

export interface RateLimitMiddlewareConfig {
  /**
   * Time window in milliseconds
   */
  windowMs: number;
  /**
   * Maximum number of requests within the window
   */
  max: number;
}

function assertRateLimitMiddlewareConfig(
  config: unknown,
): asserts config is RateLimitMiddlewareConfig {
  if (!config || typeof config !== "object") {
    throw new TypeError(
      "rateLimitTaskMiddleware requires .with({ windowMs, max }) configuration.",
    );
  }

  const maybe = config as Partial<RateLimitMiddlewareConfig>;
  if (maybe.windowMs === undefined || maybe.max === undefined) {
    throw new TypeError(
      "rateLimitTaskMiddleware requires .with({ windowMs, max }) configuration.",
    );
  }

  if (!Number.isFinite(maybe.windowMs) || (maybe.windowMs as number) <= 0) {
    throw new TypeError(
      "rateLimitTaskMiddleware requires a positive number for config.windowMs.",
    );
  }

  if (!Number.isFinite(maybe.max) || (maybe.max as number) <= 0) {
    throw new TypeError(
      "rateLimitTaskMiddleware requires a positive number for config.max.",
    );
  }
}

const rateLimitConfigSchema = {
  parse: (config: unknown) => {
    assertRateLimitMiddlewareConfig(config);
    return config;
  },
};

/**
 * Custom error class for rate limit errors.
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface RateLimitState {
  count: number;
  resetTime: number;
}

/**
 * Journal keys exposed by the rate limit middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Number of remaining requests in the current window */
  remaining: journalHelper.createKey<number>(
    "globals.middleware.task.rateLimit.remaining",
  ),
  /** Timestamp when the current window resets */
  resetTime: journalHelper.createKey<number>(
    "globals.middleware.task.rateLimit.resetTime",
  ),
  /** Maximum requests allowed per window */
  limit: journalHelper.createKey<number>(
    "globals.middleware.task.rateLimit.limit",
  ),
} as const;

export const rateLimitResource = defineResource({
  id: "globals.resources.rateLimit",
  tags: [globalTags.system],
  init: async () => {
    return {
      states: new WeakMap<RateLimitMiddlewareConfig, RateLimitState>(),
    };
  },
});

/**
 * Rate limit middleware: limits the number of executions within a fixed time window.
 */
export const rateLimitTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.rateLimit",
  configSchema: rateLimitConfigSchema,
  dependencies: { state: rateLimitResource },
  async run(
    { task, next, journal },
    { state },
    config: RateLimitMiddlewareConfig,
  ) {
    assertRateLimitMiddlewareConfig(config);

    const { states } = state;
    let limitState = states.get(config);
    const now = Date.now();

    if (!limitState || now > limitState.resetTime) {
      limitState = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      states.set(config, limitState);
    }

    // Set journal values before checking limits
    const remaining = Math.max(0, config.max - limitState.count);
    journal.set(journalKeys.remaining, remaining, { override: true });
    journal.set(journalKeys.resetTime, limitState.resetTime, {
      override: true,
    });
    journal.set(journalKeys.limit, config.max, { override: true });

    if (limitState.count >= config.max) {
      throw new RateLimitError(
        `Rate limit exceeded. Try again after ${new Date(
          limitState.resetTime,
        ).toISOString()}`,
      );
    }

    limitState.count++;
    // Update remaining after incrementing count
    journal.set(journalKeys.remaining, config.max - limitState.count, {
      override: true,
    });
    return await next(task.input);
  },
});
