import { taskMiddlewareBuilder } from "../../definers/builders/middleware";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { RunnerError } from "../../definers/defineError";
import {
  middlewareKeyCapacityExceededError,
  middlewareRateLimitExceededError,
  RunnerErrorId,
  validationError,
} from "../../errors";
import { Match } from "../../tools/check";
import { symbolDefinitionIdentity } from "../../types/symbols";
import {
  defaultStorageTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";
import { ensureKeyedStateCapacity } from "./keyedState.shared";
import {
  applyIdentityScopeToKey,
  identityScopePattern,
  type IdentityScopedMiddlewareConfig,
} from "./identityScope.shared";
import {
  pruneRateLimitStatesForCapacity,
  rateLimitResource,
  type RateLimitState,
} from "./rateLimit.resource";
import { globalTags } from "../globalTags";
import { identityContextResource } from "../resources/identityContext.resource";

export interface RateLimitMiddlewareConfig extends IdentityScopedMiddlewareConfig {
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
   * Defaults to `storageTaskId`.
   * Provide an explicit key when you want broader grouping, such as per user or
   * per identity admission limits.
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
  identityScope: identityScopePattern,
});

const rateLimitRuntimeConfigSchema = Match.compile(rateLimitConfigPattern);

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
 * Rate limit middleware: limits the number of executions within a fixed time window.
 */
export const rateLimitTaskMiddleware = taskMiddlewareBuilder("rateLimit")
  .journal({
    /** Number of remaining requests in the current window. */
    remaining: journalHelper.createKey<number>("remaining"),
    /** Timestamp when the current window resets. */
    resetTime: journalHelper.createKey<number>("resetTime"),
    /** Maximum requests allowed per window. */
    limit: journalHelper.createKey<number>("limit"),
  })
  .tags([globalTags.identityScoped])
  .meta({
    title: "Rate Limit",
    description:
      "Enforces fixed-window task admission limits with optional identity-aware partitioning.",
  })
  .throws([
    middlewareRateLimitExceededError,
    middlewareKeyCapacityExceededError,
  ])
  .configSchema(rateLimitConfigPattern)
  .dependencies({
    state: rateLimitResource,
    identityContext: identityContextResource,
  })
  .run(
    async (
      { task, next, journal },
      { state, identityContext },
      config: RateLimitMiddlewareConfig,
    ) => {
      rateLimitRuntimeConfigSchema.parse(config);

      const storageTaskId = task.definition.id;
      const keyBuilder = config.keyBuilder ?? defaultStorageTaskKeyBuilder;
      const builtKey = keyBuilder(storageTaskId, task.input);

      if (typeof builtKey !== "string") {
        validationError.throw({
          subject: "Middleware config",
          id: storageTaskId,
          originalError: `Rate limit middleware keyBuilder must return a string. Received ${typeof builtKey}.`,
        });
      }

      const key = applyIdentityScopeToKey(
        builtKey,
        config.identityScope,
        identityContext?.tryUse,
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
        middlewareId: storageTaskId,
        prune: () => {
          pruneRateLimitStatesForCapacity(state, keyedStates, now);
        },
        size: () => keyedStates.size,
      });

      if (!hadKeyedStates || state.states.get(config) !== keyedStates) {
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
      journal.set(rateLimitTaskMiddleware.journalKeys.remaining, remaining, {
        override: true,
      });
      journal.set(
        rateLimitTaskMiddleware.journalKeys.resetTime,
        limitState.resetTime,
        {
          override: true,
        },
      );
      journal.set(rateLimitTaskMiddleware.journalKeys.limit, config.max, {
        override: true,
      });

      if (limitState.count >= config.max) {
        middlewareRateLimitExceededError.throw({
          message: `Rate limit exceeded. Try again after ${new Date(
            limitState.resetTime,
          ).toISOString()}`,
        });
      }

      limitState.count++;
      // Update remaining after incrementing count
      journal.set(
        rateLimitTaskMiddleware.journalKeys.remaining,
        config.max - limitState.count,
        {
          override: true,
        },
      );
      return await next(task.input);
    },
  )
  .build();
export type {
  RateLimitResourceState,
  RateLimitState,
} from "./rateLimit.resource";
export { rateLimitResource } from "./rateLimit.resource";
