import {
  defineFrameworkResource,
  defineFrameworkTaskMiddleware,
} from "../../definers/frameworkDefinition";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalTags } from "../globalTags";
import { RunnerError } from "../../definers/defineError";
import { middlewareRateLimitExceededError, RunnerErrorId } from "../../errors";
import { Match } from "../../tools/check";

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

const rateLimitConfigPattern = Match.ObjectIncluding({
  windowMs: Match.PositiveInteger,
  max: Match.PositiveInteger,
});

/**
 * Custom error class for rate limit errors.
 */
export class RateLimitError extends RunnerError<{ message: string }> {
  constructor(message: string) {
    super(
      RunnerErrorId.MiddlewareRateLimitExceeded,
      message,
      { message },
      middlewareRateLimitExceededError.httpCode,
    );
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
    "runner.middleware.task.rateLimit.remaining",
  ),
  /** Timestamp when the current window resets */
  resetTime: journalHelper.createKey<number>(
    "runner.middleware.task.rateLimit.resetTime",
  ),
  /** Maximum requests allowed per window */
  limit: journalHelper.createKey<number>(
    "runner.middleware.task.rateLimit.limit",
  ),
} as const;

export const rateLimitResource = defineFrameworkResource({
  id: "runner.rateLimit",
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
export const rateLimitTaskMiddleware = defineFrameworkTaskMiddleware({
  id: "runner.middleware.task.rateLimit",
  throws: [middlewareRateLimitExceededError],
  configSchema: rateLimitConfigPattern,
  dependencies: { state: rateLimitResource },
  async run(
    { task, next, journal },
    { state },
    config: RateLimitMiddlewareConfig,
  ) {
    const { states } = state;
    let limitState = states.get(config);
    const now = Date.now();

    if (!limitState || now >= limitState.resetTime) {
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
