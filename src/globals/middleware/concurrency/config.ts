import { Semaphore } from "../../../models/Semaphore";
import { validationError } from "../../../errors";
import { Match } from "../../../tools/check";
import type { ValidationSchemaInput } from "../../../types/utilities";
import { IDENTITY_SCOPE_SEPARATOR } from "../../../async-contexts/identity.constants";
import {
  identityScopePattern,
  type IdentityScopedMiddlewareConfig,
} from "../identityScope.shared";
import type { MiddlewareKeyBuilder } from "../keyBuilder.shared";
import type { ConcurrencyWaitOptions } from "./wait";

/** Running-work and admission policy for a shared concurrency pool. */
export interface ConcurrencyMiddlewareConfig
  extends IdentityScopedMiddlewareConfig, ConcurrencyWaitOptions {
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

  /** Dynamic shared pool name. Receives the canonical task id and input; mutually exclusive with key. */
  keyBuilder?: MiddlewareKeyBuilder;

  /**
   * An existing Semaphore instance to use.
   */
  semaphore?: Semaphore;
}

export const concurrencyConfigPattern: ValidationSchemaInput<ConcurrencyMiddlewareConfig> =
  Match.ObjectIncluding({
    limit: Match.Optional(Match.PositiveInteger),
    key: Match.Optional(Match.NonEmptyString),
    semaphore: Match.Optional(Semaphore),
    keyBuilder: Match.Optional(Function),
    maxQueue: Match.Optional(
      Match.Where(
        (value: unknown): value is number =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0,
      ),
    ),
    waitTimeoutMs: Match.Optional(
      Match.Where(
        (value: unknown): value is number =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= 2_147_483_647,
      ),
    ),
    identityScope: identityScopePattern,
  });

export function assertConcurrencyConfig(
  config: ConcurrencyMiddlewareConfig,
): void {
  const hasSemaphore = config.semaphore !== undefined;
  const hasLimit = config.limit !== undefined;
  const hasKey = config.key !== undefined || config.keyBuilder !== undefined;
  if (config.key !== undefined && config.keyBuilder !== undefined) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError: "Use either key or keyBuilder, not both.",
    });
  }

  if (hasSemaphore && (hasLimit || hasKey)) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError:
        "Concurrency middleware config is ambiguous. Use either { semaphore } or { limit, key? }, not both.",
    });
  }

  if (hasKey && !hasLimit) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError: 'Concurrency middleware config "key" requires "limit".',
    });
  }

  if (
    config.key !== undefined &&
    config.key.includes(IDENTITY_SCOPE_SEPARATOR)
  ) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError: `Concurrency middleware config "key" cannot contain "${IDENTITY_SCOPE_SEPARATOR}" because it is used as the separator in shared identity-scoped keys.`,
    });
  }

  if (!hasSemaphore && !hasLimit) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError:
        'Concurrency middleware requires either "limit" or "semaphore".',
    });
  }
}

/** Resolve explicit pool names before applying identity scoping. */
export function resolveConcurrencyKey(
  config: ConcurrencyMiddlewareConfig,
  taskId: string,
  input: unknown,
): string | undefined {
  if (!config.keyBuilder) return config.key;
  const key = config.keyBuilder(taskId, input);
  if (!Match.test(key, Match.NonEmptyString)) {
    return validationError.throw({
      subject: "Middleware config",
      id: taskId,
      originalError: "Concurrency keyBuilder must return a non-empty string.",
    });
  }
  return key;
}
