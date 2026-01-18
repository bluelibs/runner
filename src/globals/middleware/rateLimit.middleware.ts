import { defineTaskMiddleware } from "../../define";

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

interface RateLimitState {
  count: number;
  resetTime: number;
}

const rateLimitStates = new WeakMap<
  RateLimitMiddlewareConfig,
  RateLimitState
>();

/**
 * Rate limit middleware: limits the number of executions within a fixed time window.
 */
export const rateLimitTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.rateLimit",
  async run({ task, next }, _deps, config: RateLimitMiddlewareConfig) {
    assertRateLimitMiddlewareConfig(config);

    let state = rateLimitStates.get(config);
    const now = Date.now();

    if (!state || now > state.resetTime) {
      state = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      rateLimitStates.set(config, state);
    }

    if (state.count >= config.max) {
      throw new RateLimitError(
        `Rate limit exceeded. Try again after ${new Date(
          state.resetTime,
        ).toISOString()}`,
      );
    }

    state.count++;
    return await next(task.input);
  },
});
