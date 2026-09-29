import { getMiddlewareApplicationIdentity } from "../../models/middleware/applicationIdentity";
import {
  assertConcurrencyConfig,
  concurrencyConfigPattern,
  resolveConcurrencyKey,
  type ConcurrencyMiddlewareConfig,
} from "./concurrency/config";
import { withMemoryPermit } from "./concurrency/memory";
import {
  middlewareConcurrencyQueueFullError,
  middlewareConcurrencyWaitTimeoutError,
} from "./concurrency/errors";
import { resilienceResource } from "../resilience/resource";
import {
  getOrCreateTaskAbortController,
  getTaskAbortSignalLink,
} from "../../models/runtime/taskCancellation";
import { defineResource } from "../../definers/defineResource";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { Semaphore } from "../../models/Semaphore";
import {
  middlewareConcurrencyConflictError,
  validationError,
} from "../../errors";
import { IDENTITY_SCOPE_SEPARATOR } from "../../async-contexts/identity.constants";
import { getIdentityNamespace } from "./identityScope.shared";
import { globalTags } from "../globalTags";
import { identityContextResource } from "../resources/identityContext.resource";

export type { ConcurrencyMiddlewareConfig } from "./concurrency/config";
export type { ConcurrencyWaitOptions } from "./concurrency/wait";

export interface ConcurrencyState {
  semaphoresByConfig: WeakMap<
    ConcurrencyMiddlewareConfig,
    Map<string, Semaphore>
  >;
  semaphoresByKey: Map<string, { semaphore: Semaphore; limit: number }>;
  semaphores: Set<Semaphore>;
}

export const concurrencyResource = defineResource({
  id: "concurrency",
  meta: {
    title: "Concurrency State",
    description:
      "Tracks shared semaphores for the built-in concurrency middleware, including keyed and identity-scoped partitions.",
  },
  dependencies: { resilience: resilienceResource.optional() },
  init: async (_config, { resilience }) => ({
    resilience,
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
  tags: [globalTags.identityScoped],
  meta: {
    title: "Concurrency Limit",
    description:
      "Limits concurrent task executions with semaphores, supporting shared keys and optional identity scoping.",
  },
  throws: [
    middlewareConcurrencyConflictError,
    middlewareConcurrencyQueueFullError,
    middlewareConcurrencyWaitTimeoutError,
  ],
  configSchema: concurrencyConfigPattern,
  dependencies: {
    state: concurrencyResource,
    identityContext: identityContextResource,
  },
  async run(
    execution,
    { state, identityContext },
    config: ConcurrencyMiddlewareConfig,
  ) {
    const { task, next, journal } = execution;
    assertConcurrencyConfig(config);

    const resolvedKey = resolveConcurrencyKey(
      config,
      task.definition.id,
      task.input,
    );
    let semaphore = config.semaphore;
    const identityNamespace = getIdentityNamespace(
      config.identityScope,
      identityContext?.tryUse,
    );

    if (state.resilience) {
      if (semaphore) {
        validationError.throw({
          subject: "Middleware config",
          id: "concurrency",
          originalError:
            "Explicit local semaphores cannot be used with Redis resilience. Configure limit and optional key instead.",
        });
      }
      const key = JSON.stringify([
        resolvedKey === undefined ? "task" : "shared",
        resolvedKey ??
          getMiddlewareApplicationIdentity(execution, task.definition.id),
        identityNamespace,
      ]);
      const controller = getOrCreateTaskAbortController(journal);
      const link = getTaskAbortSignalLink(journal);
      try {
        return await state.resilience.withPermit(
          key,
          config.limit!,
          link.signal,
          (reason) => controller.abort(reason),
          () => next(task.input),
          config,
        );
      } finally {
        link.cleanup();
      }
    }
    if (!semaphore && config.limit !== undefined) {
      if (resolvedKey !== undefined) {
        const scopedKey = JSON.stringify([identityNamespace, resolvedKey]);
        const existing = state.semaphoresByKey.get(scopedKey);
        if (existing) {
          if (existing.limit !== config.limit) {
            middlewareConcurrencyConflictError.throw({
              key: `${identityNamespace}${IDENTITY_SCOPE_SEPARATOR}${resolvedKey}`,
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
        let semaphoresByIdentity = state.semaphoresByConfig.get(config);
        if (!semaphoresByIdentity) {
          semaphoresByIdentity = new Map<string, Semaphore>();
          state.semaphoresByConfig.set(config, semaphoresByIdentity);
        }

        semaphore = semaphoresByIdentity.get(identityNamespace);
        if (!semaphore) {
          semaphore = new Semaphore(config.limit);
          state.semaphores.add(semaphore);
          semaphoresByIdentity.set(identityNamespace, semaphore);
        }
      }
    }

    getOrCreateTaskAbortController(journal);
    const link = getTaskAbortSignalLink(journal);
    try {
      return await withMemoryPermit(semaphore!, config, link.signal, () =>
        next(task.input),
      );
    } finally {
      link.cleanup();
    }
  },
});
