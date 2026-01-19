import { defineResource, defineTaskMiddleware } from "../../define";
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
  id: "globals.middleware.rateLimit",
  dependencies: { state: rateLimitResource },
  async run({ task, next }, { state }, config: RateLimitMiddlewareConfig) {
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

    if (limitState.count >= config.max) {
      throw new RateLimitError(
        `Rate limit exceeded. Try again after ${new Date(
          limitState.resetTime,
        ).toISOString()}`,
      );
    }

    limitState.count++;
    return await next(task.input);
  },
});
