import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { RunnerError } from "../../definers/defineError";
import {
  middlewareKeyCapacityExceededError,
  middlewareRateLimitExceededError,
  RunnerErrorId,
} from "../../errors";
import { Match } from "../../tools/check";
import { symbolDefinitionIdentity } from "../../types/symbols";
import {
  defaultTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";
import { ensureKeyedStateCapacity } from "./keyedState.shared";
import {
  applyTenantScopeToKey,
  tenantScopePattern,
  type TenantScopedMiddlewareConfig,
} from "./tenantScope.shared";
import {
  pruneRateLimitStatesForCapacity,
  rateLimitResource,
  type RateLimitState,
} from "./rateLimit.resource";

export interface RateLimitMiddlewareConfig extends TenantScopedMiddlewareConfig {
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
  /**
   * Maximum number of distinct live keys tracked for this middleware config.
   */
  maxKeys?: number;
}

const positiveNonZeroIntegerPattern = Match.Where(
  (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0,
);

const rateLimitConfigPattern = Match.ObjectIncluding({
  windowMs: positiveNonZeroIntegerPattern,
  max: positiveNonZeroIntegerPattern,
  keyBuilder: Match.Optional(Function),
  maxKeys: Match.Optional(positiveNonZeroIntegerPattern),
  tenantScope: tenantScopePattern,
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

/**
 * Rate limit middleware: limits the number of executions within a fixed time window.
 */
export const rateLimitTaskMiddleware = defineTaskMiddleware({
  id: "rateLimit",
  throws: [
    middlewareRateLimitExceededError,
    middlewareKeyCapacityExceededError,
  ],
  configSchema: rateLimitConfigPattern,
  dependencies: { state: rateLimitResource },
  async run(
    { task, next, journal },
    { state },
    config: RateLimitMiddlewareConfig,
  ) {
    const taskId = task.definition.id;
    const keyBuilder = config.keyBuilder ?? defaultTaskKeyBuilder;
    const key = applyTenantScopeToKey(
      keyBuilder(taskId, task.input),
      config.tenantScope,
    );
    const now = Date.now();
    let keyedStates = state.states.get(config);
    const hadKeyedStates = keyedStates !== undefined;
    if (!keyedStates) {
      keyedStates = new Map<string, RateLimitState>();
    }

    ensureKeyedStateCapacity({
      hasKey: keyedStates.has(key),
      maxKeys: config.maxKeys,
      middlewareId: taskId,
      prune: () => {
        pruneRateLimitStatesForCapacity(state, keyedStates, now);
      },
      size: () => keyedStates.size,
    });

    if (!hadKeyedStates) {
      state.registerConfigMap(config, keyedStates);
    }

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
      middlewareRateLimitExceededError.throw({
        message: `Rate limit exceeded. Try again after ${new Date(
          limitState.resetTime,
        ).toISOString()}`,
      });
    }

    limitState.count++;
    // Update remaining after incrementing count
    journal.set(journalKeys.remaining, config.max - limitState.count, {
      override: true,
    });
    return await next(task.input);
  },
});

export type {
  RateLimitResourceState,
  RateLimitState,
} from "./rateLimit.resource";
export { rateLimitResource } from "./rateLimit.resource";
