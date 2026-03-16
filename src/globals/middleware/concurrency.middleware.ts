import { defineResource } from "../../definers/defineResource";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { Semaphore } from "../../models/Semaphore";
import { globalTags } from "../globalTags";
import {
  middlewareConcurrencyConflictError,
  validationError,
} from "../../errors";
import { Match } from "../../tools/check";
import {
  getTenantNamespace,
  tenantScopePattern,
  type TenantScopedMiddlewareConfig,
} from "./tenantScope.shared";

export interface ConcurrencyMiddlewareConfig extends TenantScopedMiddlewareConfig {
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
  semaphoresByConfig: WeakMap<
    ConcurrencyMiddlewareConfig,
    Map<string, Semaphore>
  >;
  semaphoresByKey: Map<string, { semaphore: Semaphore; limit: number }>;
  semaphores: Set<Semaphore>;
}

const concurrencyConfigPattern = Match.ObjectIncluding({
  limit: Match.Optional(Match.PositiveInteger),
  key: Match.Optional(Match.NonEmptyString),
  semaphore: Match.Optional(Semaphore),
  tenantScope: tenantScopePattern,
});

function assertConcurrencyConfig(config: ConcurrencyMiddlewareConfig): void {
  const hasSemaphore = config.semaphore !== undefined;
  const hasLimit = config.limit !== undefined;
  const hasKey = config.key !== undefined;

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

  if (!hasSemaphore && !hasLimit) {
    validationError.throw({
      subject: "Middleware config",
      id: "concurrency",
      originalError:
        'Concurrency middleware requires either "limit" or "semaphore".',
    });
  }
}

export const concurrencyResource = defineResource({
  id: "concurrency",
  tags: [globalTags.system],
  init: async () => ({
    semaphoresByConfig: new WeakMap<
      ConcurrencyMiddlewareConfig,
      Map<string, Semaphore>
    >(),
    semaphoresByKey: new Map<string, { semaphore: Semaphore; limit: number }>(),
    semaphores: new Set<Semaphore>(),
  }),
  dispose: async (state) => {
    for (const semaphore of state.semaphores) {
      semaphore.dispose();
    }
    state.semaphores.clear();
    state.semaphoresByKey.clear();
  },
});

/**
 * Middleware that limits concurrency of task executions using a Semaphore.
 */
export const concurrencyTaskMiddleware = defineTaskMiddleware({
  id: "concurrency",
  throws: [middlewareConcurrencyConflictError],
  configSchema: concurrencyConfigPattern,
  dependencies: { state: concurrencyResource },
  async run({ task, next }, { state }, config: ConcurrencyMiddlewareConfig) {
    assertConcurrencyConfig(config);

    let semaphore = config.semaphore;
    const tenantNamespace = getTenantNamespace(config.tenantScope);

    if (!semaphore && config.limit !== undefined) {
      if (config.key !== undefined) {
        const scopedKey = `${tenantNamespace}:${config.key}`;
        const existing = state.semaphoresByKey.get(scopedKey);
        if (existing) {
          if (existing.limit !== config.limit) {
            middlewareConcurrencyConflictError.throw({
              key: scopedKey,
              existingLimit: existing.limit,
              attemptedLimit: config.limit,
            });
          }
          semaphore = existing.semaphore;
        } else {
          semaphore = new Semaphore(config.limit);
          state.semaphores.add(semaphore);
          state.semaphoresByKey.set(scopedKey, {
            semaphore,
            limit: config.limit,
          });
        }
      } else {
        let semaphoresByTenant = state.semaphoresByConfig.get(config);
        if (!semaphoresByTenant) {
          semaphoresByTenant = new Map<string, Semaphore>();
          state.semaphoresByConfig.set(config, semaphoresByTenant);
        }

        semaphore = semaphoresByTenant.get(tenantNamespace);
        if (!semaphore) {
          semaphore = new Semaphore(config.limit);
          state.semaphores.add(semaphore);
          semaphoresByTenant.set(tenantNamespace, semaphore);
        }
      }
    }

    return semaphore!.withPermit(() => next(task?.input));
  },
});
