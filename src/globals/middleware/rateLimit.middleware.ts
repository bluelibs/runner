import { defineResource } from "../../definers/defineResource";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalTags } from "../globalTags";
import { RunnerError } from "../../definers/defineError";
import { middlewareRateLimitExceededError, RunnerErrorId } from "../../errors";
import { Match } from "../../tools/check";
import { symbolDefinitionIdentity } from "../../types/symbols";
import {
  defaultTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";

export interface RateLimitMiddlewareConfig {
  /**
   * Time window in milliseconds
   */
  windowMs: number;
  /**
   * Maximum number of requests within the window
   */
  max: number;
  /**
   * Builds the partition key used to isolate fixed-window counters.
   * Defaults to the task id.
   */
  keyBuilder?: MiddlewareKeyBuilder;
}

const rateLimitConfigPattern = Match.ObjectIncluding({
  windowMs: Match.PositiveInteger,
  max: Match.PositiveInteger,
  keyBuilder: Match.Optional(Function),
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
      undefined,
      middlewareRateLimitExceededError[symbolDefinitionIdentity],
    );
  }
}

export interface RateLimitState {
  count: number;
  resetTime: number;
}

const RATE_LIMIT_STATE_PRUNE_THRESHOLD = 1_000;

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

export const rateLimitResource = defineResource(
  markFrameworkDefinition({
    id: "runner.rateLimit",
    tags: [globalTags.system],
    init: async () => {
      return {
        states: new WeakMap<
          RateLimitMiddlewareConfig,
          Map<string, RateLimitState>
        >(),
      };
    },
  }),
);

function pruneExpiredRateLimitStates(
  keyedStates: Map<string, RateLimitState>,
  now: number,
) {
  if (keyedStates.size < RATE_LIMIT_STATE_PRUNE_THRESHOLD) {
    return;
  }

  for (const [key, keyedState] of keyedStates) {
    if (now >= keyedState.resetTime) {
      keyedStates.delete(key);
    }
  }
}

/**
 * Rate limit middleware: limits the number of executions within a fixed time window.
 */
export const rateLimitTaskMiddleware = defineTaskMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.task.rateLimit",
    throws: [middlewareRateLimitExceededError],
    configSchema: rateLimitConfigPattern,
    dependencies: { state: rateLimitResource },
    async run(
      { task, next, journal },
      { state },
      config: RateLimitMiddlewareConfig,
    ) {
      const taskId = task.definition.id;
      const keyBuilder = config.keyBuilder ?? defaultTaskKeyBuilder;
      const key = keyBuilder(taskId, task.input);
      const { states } = state;
      const now = Date.now();
      let keyedStates = states.get(config);

      if (!keyedStates) {
        keyedStates = new Map<string, RateLimitState>();
        states.set(config, keyedStates);
      }

      pruneExpiredRateLimitStates(keyedStates, now);

      let limitState = keyedStates.get(key);

      if (!limitState || now >= limitState.resetTime) {
        limitState = {
          count: 0,
          resetTime: now + config.windowMs,
        };
        keyedStates.set(key, limitState);
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
  }),
);
