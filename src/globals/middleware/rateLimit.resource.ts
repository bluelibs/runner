import { defineResource } from "../../definers/defineResource";
import { globalTags } from "../globalTags";
import {
  deriveKeyedStateCleanupInterval,
  syncCleanupTimer,
  type CleanupTimerState,
} from "./keyedState.shared";
import { timersResource } from "../resources/timers.resource";
import type { ITimers } from "../../types/timers";

export interface RateLimitState {
  count: number;
  resetTime: number;
}

/**
 * Internal resource state used by the built-in rate-limit middleware.
 */
export interface RateLimitResourceState {
  states: WeakMap<RateLimitResourceConfig, Map<string, RateLimitState>>;
  trackedStates: Map<RateLimitResourceConfig, Map<string, RateLimitState>>;
  disposeCleanupTimer: () => void;
  registerConfigMap: (
    config: RateLimitResourceConfig,
    keyedStates: Map<string, RateLimitState>,
  ) => void;
  sweepExpiredStates: (now: number) => void;
}

type RateLimitResourceConfig = {
  windowMs: number;
};

type RateLimitResourceContext = CleanupTimerState;

function pruneExpiredRateLimitStates(
  keyedStates: Map<string, RateLimitState>,
  now: number,
): void {
  for (const [key, keyedState] of keyedStates) {
    if (now >= keyedState.resetTime) {
      keyedStates.delete(key);
    }
  }
}

export function pruneRateLimitStatesForCapacity(
  state: RateLimitResourceState,
  keyedStates: Map<string, RateLimitState>,
  now: number,
): void {
  state.sweepExpiredStates?.(now);
  if (!state.sweepExpiredStates) {
    pruneExpiredRateLimitStates(keyedStates, now);
  }
}

export const rateLimitResource = defineResource({
  id: "rateLimit",
  tags: [globalTags.system],
  dependencies: { timers: timersResource },
  context: (): RateLimitResourceContext => ({}),
  init: async (
    _config,
    { timers }: { timers: ITimers },
    context: RateLimitResourceContext,
  ): Promise<RateLimitResourceState> => {
    const trackedStates = new Map<
      RateLimitResourceConfig,
      Map<string, RateLimitState>
    >();
    const states = new WeakMap<
      RateLimitResourceConfig,
      Map<string, RateLimitState>
    >();

    const getCleanupInterval = () =>
      deriveKeyedStateCleanupInterval(
        Array.from(trackedStates.keys(), (config) => config.windowMs),
      );

    const syncResourceCleanupTimer = () => {
      syncCleanupTimer(context, timers, getCleanupInterval(), () => {
        resourceState.sweepExpiredStates(Date.now());
      });
    };

    const resourceState: RateLimitResourceState = {
      states,
      trackedStates,
      disposeCleanupTimer: () => {
        syncCleanupTimer(context, timers, undefined);
      },
      registerConfigMap: (config, keyedStates) => {
        states.set(config, keyedStates);
        trackedStates.set(config, keyedStates);
        syncResourceCleanupTimer();
      },
      sweepExpiredStates: (now: number) => {
        for (const [config, keyedStates] of trackedStates) {
          pruneExpiredRateLimitStates(keyedStates, now);
          if (keyedStates.size === 0) {
            trackedStates.delete(config);
            states.delete(config);
          }
        }

        syncResourceCleanupTimer();
      },
    };

    return resourceState;
  },
  cooldown: async (_state, _config, _deps, context) => {
    context.cleanupTimer?.cancel();
    context.cleanupTimer = undefined;
    context.cleanupIntervalMs = undefined;
  },
  dispose: async (state, _config, _deps, context) => {
    state.trackedStates.clear();
    state.disposeCleanupTimer();
    context.cleanupTimer = undefined;
    context.cleanupIntervalMs = undefined;
  },
});
