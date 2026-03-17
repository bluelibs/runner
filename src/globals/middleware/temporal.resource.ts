import { defineResource } from "../../definers/defineResource";
import { middlewareTemporalDisposedError } from "../../errors";
import type { ITimers } from "../../types/timers";
import { timersResource } from "../resources/timers.resource";
import {
  deriveKeyedStateCleanupInterval,
  syncCleanupTimer,
  type CleanupTimerState,
} from "./keyedState.shared";
import {
  type DebounceState,
  pruneIdleThrottleStates,
  pruneStaleDebounceStates,
  rejectDebounceState,
  rejectThrottleState,
  type TemporalResourceState,
  type ThrottleState,
} from "./temporal.shared";

type TemporalResourceContext = CleanupTimerState;

type TemporalResourceConfig = {
  ms: number;
};

const TEMPORAL_DISPOSED_ERROR_MESSAGE =
  "Temporal middleware resource has been disposed.";

export function createTemporalDisposedError() {
  return middlewareTemporalDisposedError.new({
    message: TEMPORAL_DISPOSED_ERROR_MESSAGE,
  });
}

export function deleteEmptyDebounceStateMap<TConfig extends object>(
  state: TemporalResourceState<TConfig>,
  config: TConfig,
  keyedStates: Map<string, DebounceState>,
): void {
  if (keyedStates.size > 0) {
    return;
  }

  state.debounceStateMaps?.delete(config);
  state.debounceStates.delete(config);
  state.sweepIdleStates?.(Date.now());
}

export function pruneDebounceStatesForCapacity<TConfig extends { ms: number }>(
  state: TemporalResourceState<TConfig>,
  debounceStates: Map<string, DebounceState>,
  config: TConfig,
): void {
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

export function pruneThrottleStatesForCapacity<TConfig extends { ms: number }>(
  state: TemporalResourceState<TConfig>,
  throttleStates: Map<string, ThrottleState>,
  config: TConfig,
): void {
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
  dependencies: { timers: timersResource },
  context: (): TemporalResourceContext => ({}),
  init: async (
    _config,
    { timers }: { timers: ITimers },
    context: TemporalResourceContext,
  ): Promise<TemporalResourceState<TemporalResourceConfig>> => {
    const debounceStates = new WeakMap<
      TemporalResourceConfig,
      Map<string, DebounceState>
    >();
    const throttleStates = new WeakMap<
      TemporalResourceConfig,
      Map<string, ThrottleState>
    >();
    const debounceStateMaps = new Map<
      TemporalResourceConfig,
      Map<string, DebounceState>
    >();
    const throttleStateMaps = new Map<
      TemporalResourceConfig,
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

    const resourceState: TemporalResourceState<TemporalResourceConfig> = {
      debounceStates,
      throttleStates,
      debounceStateMaps,
      throttleStateMaps,
      trackedDebounceStates: new Set<DebounceState>(),
      trackedThrottleStates: new Set<ThrottleState>(),
      disposeCleanupTimer: () => {
        syncCleanupTimer(context, timers, undefined);
      },
      registerDebounceStateMap: (config, keyedStates) => {
        debounceStates.set(config, keyedStates);
        debounceStateMaps.set(config, keyedStates);
        syncResourceCleanupTimer();
      },
      registerThrottleStateMap: (config, keyedStates) => {
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
  dispose: async (state: TemporalResourceState<TemporalResourceConfig>) => {
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
