import type { RegisterableItems } from "../defs";
import { globalEventsArray } from "../globals/globalEvents";
import { globalResources } from "../globals/globalResources";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "../globals/middleware/timeout.middleware";
import {
  concurrencyTaskMiddleware,
  concurrencyResource,
} from "../globals/middleware/concurrency.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
  temporalResource,
} from "../globals/middleware/temporal.middleware";
import { fallbackTaskMiddleware } from "../globals/middleware/fallback.middleware";
import {
  rateLimitTaskMiddleware,
  rateLimitResource,
} from "../globals/middleware/rateLimit.middleware";
import {
  circuitBreakerMiddleware,
  circuitBreakerResource,
} from "../globals/middleware/circuitBreaker.middleware";
import { globalTags } from "../globals/globalTags";
import {
  checkInvalidOptionsError,
  checkInvalidPatternError,
  checkJsonSchemaUnsupportedPatternError,
  durableExecutionError,
  matchError,
  middlewareCircuitBreakerOpenError,
  middlewareRateLimitExceededError,
  middlewareTimeoutError,
} from "../errors";

function collectUniqueTags(): RegisterableItems[] {
  const uniqueTags: RegisterableItems[] = [];
  const seenIds = new Set<string>();

  for (const tag of Object.values(globalTags)) {
    if (seenIds.has(tag.id)) {
      continue;
    }
    seenIds.add(tag.id);
    uniqueTags.push(tag);
  }

  return uniqueTags;
}

export const SYSTEM_FRAMEWORK_ITEMS: readonly RegisterableItems[] =
  Object.freeze([
    globalResources.store,
    globalResources.eventManager,
    globalResources.taskRunner,
    globalResources.middlewareManager,
    globalResources.runtime,
    ...collectUniqueTags().filter((tag) => tag.id.startsWith("system.")),
    ...globalEventsArray,
  ]);

export const RUNNER_FRAMEWORK_ITEMS: readonly RegisterableItems[] =
  Object.freeze([
    globalResources.health,
    globalResources.timers,
    globalResources.logger,
    globalResources.serializer,
    globalResources.queue,
    ...collectUniqueTags().filter((tag) => tag.id.startsWith("runner.")),
    requireContextTaskMiddleware,
    retryTaskMiddleware,
    timeoutTaskMiddleware,
    concurrencyTaskMiddleware,
    debounceTaskMiddleware,
    throttleTaskMiddleware,
    fallbackTaskMiddleware,
    rateLimitTaskMiddleware,
    circuitBreakerMiddleware,
    retryResourceMiddleware,
    timeoutResourceMiddleware,
    rateLimitResource,
    circuitBreakerResource,
    temporalResource,
    concurrencyResource,
    matchError,
    checkInvalidPatternError,
    checkInvalidOptionsError,
    checkJsonSchemaUnsupportedPatternError,
    middlewareTimeoutError,
    middlewareCircuitBreakerOpenError,
    middlewareRateLimitExceededError,
    durableExecutionError,
  ]);
