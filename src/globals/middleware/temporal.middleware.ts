import { defineResource } from "../../definers/defineResource";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { globalTags } from "../globalTags";
import {
  middlewareKeyCapacityExceededError,
  middlewareTemporalDisposedError,
  validationError,
} from "../../errors";
import { Match } from "../../tools/check";
import {
  defaultTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";
import {
  deriveKeyedStateCleanupInterval,
  ensureKeyedStateCapacity,
  syncCleanupTimer,
  type CleanupTimerState,
} from "./keyedState.shared";
import {
  applyTenantScopeToKey,
  tenantScopePattern,
  type TenantScopedMiddlewareConfig,
} from "./tenantScope.shared";
import {
  type DebounceState,
  pruneStaleDebounceStates,
  pruneIdleThrottleStates,
  rejectDebounceState,
  rejectThrottleState,
  type TemporalResourceState,
  type ThrottleState,
} from "./temporal.shared";
import { timersResource } from "../resources/timers.resource";
import type { ITimers } from "../../types/timers";

export interface TemporalMiddlewareConfig extends TenantScopedMiddlewareConfig {
  ms: number;
  keyBuilder?: MiddlewareKeyBuilder;
  maxKeys?: number;
}

const positiveNonZeroIntegerPattern = Match.Where(
  (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0,
);

const temporalConfigPattern = Match.ObjectIncluding({
  ms: Match.PositiveInteger,
  keyBuilder: Match.Optional(Function),
  maxKeys: Match.Optional(positiveNonZeroIntegerPattern),
  tenantScope: tenantScopePattern,
});

const TEMPORAL_DISPOSED_ERROR_MESSAGE =
  "Temporal middleware resource has been disposed.";

type TemporalResourceContext = CleanupTimerState;

function createTemporalDisposedError() {
  return middlewareTemporalDisposedError.new({
    message: TEMPORAL_DISPOSED_ERROR_MESSAGE,
  });
}

function buildTemporalMiddlewareKey(
  config: TemporalMiddlewareConfig,
  taskId: string,
  input: unknown,
): string {
  const key = (config.keyBuilder ?? defaultTaskKeyBuilder)(taskId, input);

  if (typeof key !== "string") {
    validationError.throw({
      subject: "Middleware config",
      id: taskId,
      originalError: `Temporal middleware keyBuilder must return a string. Received ${typeof key}.`,
    });
  }

  return applyTenantScopeToKey(key, config.tenantScope);
}

function deleteEmptyDebounceStateMap(
  state: TemporalResourceState<TemporalMiddlewareConfig>,
  config: TemporalMiddlewareConfig,
  keyedStates: Map<string, DebounceState>,
) {
  if (keyedStates.size > 0) {
    return;
  }

  state.debounceStateMaps?.delete(config);
  state.debounceStates.delete(config);
  state.sweepIdleStates?.(Date.now());
}

function pruneDebounceStatesForCapacity(
  state: TemporalResourceState<TemporalMiddlewareConfig>,
  debounceStates: Map<string, DebounceState>,
  config: TemporalMiddlewareConfig,
) {
  if (state.sweepIdleStates) {
    state.sweepIdleStates(Date.now());
    return;
  }

  pruneStaleDebounceStates(
    debounceStates,
    state.trackedDebounceStates,
    Date.now(),
    config.ms,
  );
}

function pruneThrottleStatesForCapacity(
  state: TemporalResourceState<TemporalMiddlewareConfig>,
  throttleStates: Map<string, ThrottleState>,
  config: TemporalMiddlewareConfig,
) {
  if (state.sweepIdleStates) {
    state.sweepIdleStates(Date.now());
    return;
  }

  pruneIdleThrottleStates(
    throttleStates,
    state.trackedThrottleStates,
    Date.now(),
    config.ms,
  );
}

export const temporalResource = defineResource({
  id: "temporal",
  tags: [globalTags.system],
  dependencies: { timers: timersResource },
  context: (): TemporalResourceContext => ({}),
  init: async (
    _config,
    { timers }: { timers: ITimers },
    context: TemporalResourceContext,
  ): Promise<TemporalResourceState<TemporalMiddlewareConfig>> => {
    const debounceStates = new WeakMap<
      TemporalMiddlewareConfig,
      Map<string, DebounceState>
    >();
    const throttleStates = new WeakMap<
      TemporalMiddlewareConfig,
      Map<string, ThrottleState>
    >();
    const debounceStateMaps = new Map<
      TemporalMiddlewareConfig,
      Map<string, DebounceState>
    >();
    const throttleStateMaps = new Map<
      TemporalMiddlewareConfig,
      Map<string, ThrottleState>
    >();

    const getCleanupInterval = () =>
      deriveKeyedStateCleanupInterval([
        ...Array.from(debounceStateMaps.keys(), (config) => config.ms),
        ...Array.from(throttleStateMaps.keys(), (config) => config.ms),
      ]);

    const syncResourceCleanupTimer = () => {
      syncCleanupTimer(context, timers, getCleanupInterval(), () => {
        resourceState.sweepIdleStates?.(Date.now());
      });
    };

    const resourceState: TemporalResourceState<TemporalMiddlewareConfig> = {
      debounceStates,
      throttleStates,
      debounceStateMaps,
      throttleStateMaps,
      trackedDebounceStates: new Set<DebounceState>(),
      trackedThrottleStates: new Set<ThrottleState>(),
      disposeCleanupTimer: () => {
        syncCleanupTimer(context, timers, undefined);
      },
      registerDebounceStateMap: (
        config: TemporalMiddlewareConfig,
        keyedStates: Map<string, DebounceState>,
      ) => {
        debounceStates.set(config, keyedStates);
        debounceStateMaps.set(config, keyedStates);
        syncResourceCleanupTimer();
      },
      registerThrottleStateMap: (
        config: TemporalMiddlewareConfig,
        keyedStates: Map<string, ThrottleState>,
      ) => {
        throttleStates.set(config, keyedStates);
        throttleStateMaps.set(config, keyedStates);
        syncResourceCleanupTimer();
      },
      sweepIdleStates: (now: number) => {
        for (const [config, keyedStates] of debounceStateMaps) {
          pruneStaleDebounceStates(
            keyedStates,
            resourceState.trackedDebounceStates,
            now,
            config.ms,
          );
          if (keyedStates.size === 0) {
            debounceStateMaps.delete(config);
            debounceStates.delete(config);
          }
        }

        for (const [config, keyedStates] of throttleStateMaps) {
          pruneIdleThrottleStates(
            keyedStates,
            resourceState.trackedThrottleStates,
            now,
            config.ms,
          );
          if (keyedStates.size === 0) {
            throttleStateMaps.delete(config);
            throttleStates.delete(config);
          }
        }

        syncResourceCleanupTimer();
      },
      isDisposed: false,
    };

    return resourceState;
  },
  cooldown: async (_state, _config, _deps, context) => {
    context.cleanupTimer?.cancel();
    context.cleanupTimer = undefined;
    context.cleanupIntervalMs = undefined;
  },
  dispose: async (state: TemporalResourceState<TemporalMiddlewareConfig>) => {
    state.isDisposed = true;
    state.disposeCleanupTimer?.();
    const disposeError = createTemporalDisposedError();
    const trackedDebounceStates = state.trackedDebounceStates;
    const trackedThrottleStates = state.trackedThrottleStates;

    trackedDebounceStates.forEach((debounceState) => {
      rejectDebounceState(debounceState, disposeError);
    });

    trackedThrottleStates.forEach((throttleState) => {
      rejectThrottleState(throttleState, disposeError);
    });

    trackedDebounceStates.clear();
    trackedThrottleStates.clear();
    state.debounceStateMaps?.clear();
    state.throttleStateMaps?.clear();
  },
});

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
  dependencies: { state: temporalResource },
  async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const taskId = task.definition.id;
    const key = buildTemporalMiddlewareKey(config, taskId, task.input);
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

/**
 * Throttle middleware: ensures execution at most once every `ms`.
 * If calls occur within the window, the last one is scheduled for the end of the window.
 */
export const throttleTaskMiddleware = defineTaskMiddleware({
  id: "throttle",
  throws: [middlewareTemporalDisposedError, middlewareKeyCapacityExceededError],
  configSchema: temporalConfigPattern,
  dependencies: { state: temporalResource },
  async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const taskId = task.definition.id;
    const key = buildTemporalMiddlewareKey(config, taskId, task.input);
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
