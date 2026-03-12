import { defineResource } from "../../definers/defineResource";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { globalTags } from "../globalTags";
import { middlewareTemporalDisposedError, validationError } from "../../errors";
import { Match } from "../../tools/check";
import {
  defaultTaskKeyBuilder,
  type MiddlewareKeyBuilder,
} from "./keyBuilder.shared";
import {
  applyTenantScopeToKey,
  tenantScopePattern,
  type TenantScopedMiddlewareConfig,
} from "./tenantScope.shared";
import {
  type DebounceState,
  pruneIdleThrottleStates,
  rejectDebounceState,
  rejectThrottleState,
  type TemporalResourceState,
  type ThrottleState,
} from "./temporal.shared";

export interface TemporalMiddlewareConfig extends TenantScopedMiddlewareConfig {
  ms: number;
  keyBuilder?: MiddlewareKeyBuilder;
}

const temporalConfigPattern = Match.ObjectIncluding({
  ms: Match.PositiveInteger,
  keyBuilder: Match.Optional(Function),
  tenantScope: tenantScopePattern,
});

const TEMPORAL_DISPOSED_ERROR_MESSAGE =
  "Temporal middleware resource has been disposed.";

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

function getDebounceStatesForConfig(
  state: TemporalResourceState<TemporalMiddlewareConfig>,
  config: TemporalMiddlewareConfig,
) {
  let keyedStates = state.debounceStates.get(config);
  if (!keyedStates) {
    keyedStates = new Map<string, DebounceState>();
    state.debounceStates.set(config, keyedStates);
  }
  return keyedStates;
}

function getThrottleStatesForConfig(
  state: TemporalResourceState<TemporalMiddlewareConfig>,
  config: TemporalMiddlewareConfig,
) {
  let keyedStates = state.throttleStates.get(config);
  if (!keyedStates) {
    keyedStates = new Map<string, ThrottleState>();
    state.throttleStates.set(config, keyedStates);
  }
  return keyedStates;
}

export const temporalResource = defineResource(
  markFrameworkDefinition({
    id: "runner.temporal",
    tags: [globalTags.system],
    init: async (): Promise<
      TemporalResourceState<TemporalMiddlewareConfig>
    > => {
      return {
        debounceStates: new WeakMap<
          TemporalMiddlewareConfig,
          Map<string, DebounceState>
        >(),
        throttleStates: new WeakMap<
          TemporalMiddlewareConfig,
          Map<string, ThrottleState>
        >(),
        trackedDebounceStates: new Set<DebounceState>(),
        trackedThrottleStates: new Set<ThrottleState>(),
        isDisposed: false,
      };
    },
    dispose: async (state: TemporalResourceState<TemporalMiddlewareConfig>) => {
      state.isDisposed = true;
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
    },
  }),
);

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
export const debounceTaskMiddleware = defineTaskMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.task.debounce",
    throws: [middlewareTemporalDisposedError],
    configSchema: temporalConfigPattern,
    dependencies: { state: temporalResource },
    async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
      if (state.isDisposed === true) {
        throw createTemporalDisposedError();
      }

      const taskId = task.definition.id;
      const key = buildTemporalMiddlewareKey(config, taskId, task.input);
      const debounceStates = getDebounceStatesForConfig(state, config);
      const trackedDebounceStates = state.trackedDebounceStates;
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
        debounceStates.delete(debounceState!.key);
        trackedDebounceStates.delete(debounceState!);

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
  }),
);

/**
 * Throttle middleware: ensures execution at most once every `ms`.
 * If calls occur within the window, the last one is scheduled for the end of the window.
 */
export const throttleTaskMiddleware = defineTaskMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.task.throttle",
    throws: [middlewareTemporalDisposedError],
    configSchema: temporalConfigPattern,
    dependencies: { state: temporalResource },
    async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
      if (state.isDisposed === true) {
        throw createTemporalDisposedError();
      }

      const taskId = task.definition.id;
      const key = buildTemporalMiddlewareKey(config, taskId, task.input);
      const throttleStates = getThrottleStatesForConfig(state, config);
      const trackedThrottleStates = state.trackedThrottleStates;
      pruneIdleThrottleStates(
        throttleStates,
        trackedThrottleStates,
        Date.now(),
        config.ms,
      );
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
  }),
);
