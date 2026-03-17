import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import {
  middlewareKeyCapacityExceededError,
  middlewareTemporalDisposedError,
  validationError,
} from "../../errors";
import { Match } from "../../tools/check";
import type { ValidationSchemaInput } from "../../types/utilities";
import {
  createMiddlewareKeyBuilderHelpers,
  defaultTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";
import { ensureKeyedStateCapacity } from "./keyedState.shared";
import {
  applyIdentityScopeToKey,
  identityScopePattern,
  type IdentityScopedMiddlewareConfig,
} from "./identityScope.shared";
import { type DebounceState, type ThrottleState } from "./temporal.shared";
import {
  createTemporalDisposedError,
  deleteEmptyDebounceStateMap,
  pruneDebounceStatesForCapacity,
  pruneThrottleStatesForCapacity,
  temporalResource,
} from "./temporal.resource";
import { identityContextResource } from "../resources/identityContext.resource";

export interface TemporalMiddlewareConfig extends IdentityScopedMiddlewareConfig {
  /**
   * Debounce/throttle window in milliseconds.
   */
  ms: number;
  /**
   * Builds the partition key for collapse/coalescing behavior.
   * Defaults to `canonicalTaskKey + ":" + serialized input`, so different
   * payloads stay isolated unless you intentionally provide a broader grouping
   * key.
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

const temporalConfigPattern: ValidationSchemaInput<TemporalMiddlewareConfig> =
  Match.ObjectIncluding({
    ms: Match.PositiveInteger,
    keyBuilder: Match.Optional(Function),
    maxKeys: Match.Optional(positiveNonZeroIntegerPattern),
    identityScope: identityScopePattern,
  });

function buildTemporalMiddlewareKey(
  config: TemporalMiddlewareConfig,
  taskId: string,
  input: unknown,
  readIdentity?: () => unknown,
): string {
  const key = (config.keyBuilder ?? defaultTaskKeyBuilder)(
    taskId,
    input,
    createMiddlewareKeyBuilderHelpers(taskId),
  );

  if (typeof key !== "string") {
    validationError.throw({
      subject: "Middleware config",
      id: taskId,
      originalError: `Temporal middleware keyBuilder must return a string. Received ${typeof key}.`,
    });
  }

  return applyIdentityScopeToKey(key, config.identityScope, readIdentity);
}

export type {
  DebounceState,
  ThrottleState,
  TemporalResourceState,
} from "./temporal.shared";

/**
 * Debounce middleware: delays execution until `ms` has passed since the last call.
 * If multiple calls occur within the window, only the last one is executed,
 * and all callers receive the same result.
 */
export const debounceTaskMiddleware = defineTaskMiddleware({
  id: "debounce",
  throws: [middlewareTemporalDisposedError, middlewareKeyCapacityExceededError],
  configSchema: temporalConfigPattern,
  dependencies: {
    state: temporalResource,
    identityContext: identityContextResource,
  },
  async run(
    { task, next },
    { state, identityContext },
    config: TemporalMiddlewareConfig,
  ) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const taskId = task.definition.id;
    const key = buildTemporalMiddlewareKey(
      config,
      taskId,
      task.input,
      identityContext?.tryUse,
    );
    let debounceStates = state.debounceStates.get(config);
    const hadDebounceStates = debounceStates !== undefined;
    if (!debounceStates) {
      debounceStates = new Map<string, DebounceState>();
    }
    const trackedDebounceStates = state.trackedDebounceStates;

    ensureKeyedStateCapacity({
      hasKey: debounceStates.has(key),
      maxKeys: config.maxKeys,
      middlewareId: taskId,
      prune: () => {
        pruneDebounceStatesForCapacity(state, debounceStates, config);
      },
      size: () => debounceStates.size,
    });

    if (!hadDebounceStates) {
      state.debounceStates.set(config, debounceStates);
      state.registerDebounceStateMap?.(config, debounceStates);
    }

    let debounceState = debounceStates.get(key);
    if (!debounceState) {
      debounceState = {
        key,
        resolveList: [],
        rejectList: [],
      };
      debounceStates.set(key, debounceState);
      trackedDebounceStates.add(debounceState);
    }

    debounceState.latestInput = task.input;
    debounceState.scheduledAt = Date.now();

    if (debounceState.timeoutId) {
      clearTimeout(debounceState.timeoutId);
    }

    const promise = new Promise((resolve, reject) => {
      debounceState!.resolveList.push(resolve);
      debounceState!.rejectList.push(reject);
    });

    debounceState.timeoutId = setTimeout(async () => {
      const { resolveList, rejectList, latestInput } = debounceState!;
      debounceState!.timeoutId = undefined;
      debounceState!.resolveList = [];
      debounceState!.rejectList = [];
      debounceState!.latestInput = undefined;
      debounceState!.scheduledAt = undefined;
      debounceStates.delete(debounceState!.key);
      trackedDebounceStates.delete(debounceState!);
      deleteEmptyDebounceStateMap(state, config, debounceStates);

      if (state.isDisposed === true) {
        const disposeError = createTemporalDisposedError();
        rejectList.forEach((reject: (error: unknown) => void) => {
          reject(disposeError);
        });
        return;
      }

      try {
        const result = await next(latestInput);
        resolveList.forEach((resolve: (value: unknown) => void) => {
          resolve(result);
        });
      } catch (error) {
        rejectList.forEach((reject: (error: unknown) => void) => {
          reject(error);
        });
      }
    }, config.ms);

    return promise;
  },
});

export { temporalResource } from "./temporal.resource";

/**
 * Throttle middleware: ensures execution at most once every `ms`.
 * If calls occur within the window, the last one is scheduled for the end of the window.
 */
export const throttleTaskMiddleware = defineTaskMiddleware({
  id: "throttle",
  throws: [middlewareTemporalDisposedError, middlewareKeyCapacityExceededError],
  configSchema: temporalConfigPattern,
  dependencies: {
    state: temporalResource,
    identityContext: identityContextResource,
  },
  async run(
    { task, next },
    { state, identityContext },
    config: TemporalMiddlewareConfig,
  ) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const taskId = task.definition.id;
    const key = buildTemporalMiddlewareKey(
      config,
      taskId,
      task.input,
      identityContext?.tryUse,
    );
    let throttleStates = state.throttleStates.get(config);
    const hadThrottleStates = throttleStates !== undefined;
    if (!throttleStates) {
      throttleStates = new Map<string, ThrottleState>();
    }
    const trackedThrottleStates = state.trackedThrottleStates;

    ensureKeyedStateCapacity({
      hasKey: throttleStates.has(key),
      maxKeys: config.maxKeys,
      middlewareId: taskId,
      prune: () => {
        pruneThrottleStatesForCapacity(state, throttleStates, config);
      },
      size: () => throttleStates.size,
    });

    if (!hadThrottleStates) {
      state.throttleStates.set(config, throttleStates);
      state.registerThrottleStateMap?.(config, throttleStates);
    }

    let throttleState = throttleStates.get(key);
    if (!throttleState) {
      throttleState = {
        key,
        lastExecution: 0,
        resolveList: [],
        rejectList: [],
      };
      throttleStates.set(key, throttleState);
      trackedThrottleStates.add(throttleState);
    }

    const now = Date.now();
    const remaining = config.ms - (now - throttleState.lastExecution);

    if (remaining <= 0) {
      let pendingResolves: Array<(value: unknown) => void> = [];
      let pendingRejects: Array<(error: unknown) => void> = [];

      if (throttleState.timeoutId) {
        // This can happen if a scheduled timeout from the previous window is
        // still pending (eg: event-loop stalls). Cancel it and settle its callers
        // using the immediate execution result.
        pendingResolves = throttleState.resolveList;
        pendingRejects = throttleState.rejectList;

        clearTimeout(throttleState.timeoutId);
        throttleState.timeoutId = undefined;
        throttleState.resolveList = [];
        throttleState.rejectList = [];
        throttleState.currentPromise = undefined;
        throttleState.latestInput = undefined;
      }
      throttleState.lastExecution = now;
      try {
        const result = await next(task.input);
        pendingResolves.forEach((resolve) => {
          resolve(result);
        });
        return result;
      } catch (error) {
        pendingRejects.forEach((reject) => {
          reject(error);
        });
        throw error;
      }
    } else {
      throttleState.latestInput = task.input;
      if (!throttleState.timeoutId) {
        throttleState.currentPromise = new Promise((resolve, reject) => {
          throttleState!.resolveList.push(resolve);
          throttleState!.rejectList.push(reject);
        });

        throttleState.timeoutId = setTimeout(async () => {
          const { resolveList, rejectList, latestInput } = throttleState!;
          throttleState!.timeoutId = undefined;
          throttleState!.lastExecution = Date.now();
          throttleState!.resolveList = [];
          throttleState!.rejectList = [];
          throttleState!.currentPromise = undefined;
          throttleState!.latestInput = undefined;

          if (state.isDisposed === true) {
            const disposeError = createTemporalDisposedError();
            rejectList.forEach((reject: (error: unknown) => void) => {
              reject(disposeError);
            });
            return;
          }

          try {
            const result = await next(latestInput);
            resolveList.forEach((resolve: (value: unknown) => void) => {
              resolve(result);
            });
          } catch (error) {
            rejectList.forEach((reject: (error: unknown) => void) => {
              reject(error);
            });
          }
        }, remaining);
      } else {
        // Update input for the scheduled execution
        throttleState.latestInput = task.input;
        return new Promise((resolve, reject) => {
          throttleState!.resolveList.push(resolve);
          throttleState!.rejectList.push(reject);
        });
      }
      return throttleState.currentPromise;
    }
  },
});
