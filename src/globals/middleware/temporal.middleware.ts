import { defineTaskMiddleware, defineResource } from "../../define";
import { globalTags } from "../globalTags";

export interface TemporalMiddlewareConfig {
  ms: number;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface DebounceState {
  timeoutId?: TimeoutHandle;
  latestInput?: any;
  resolveList: ((value: any) => void)[];
  rejectList: ((error: any) => void)[];
}

export interface ThrottleState {
  lastExecution: number;
  timeoutId?: TimeoutHandle;
  latestInput?: any;
  resolveList: ((value: any) => void)[];
  rejectList: ((error: any) => void)[];
  currentPromise?: Promise<any>;
}

export interface TemporalResourceState {
  debounceStates: WeakMap<TemporalMiddlewareConfig, DebounceState>;
  throttleStates: WeakMap<TemporalMiddlewareConfig, ThrottleState>;
  trackedDebounceStates: Set<DebounceState>;
  trackedThrottleStates: Set<ThrottleState>;
  isDisposed: boolean;
}

const TEMPORAL_DISPOSED_ERROR_MESSAGE =
  "Temporal middleware resource has been disposed.";

function createTemporalDisposedError() {
  return new Error(TEMPORAL_DISPOSED_ERROR_MESSAGE);
}

function rejectDebounceState(state: DebounceState, error: Error) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }

  const { rejectList } = state;
  state.resolveList = [];
  state.rejectList = [];
  state.latestInput = undefined;
  rejectList.forEach((reject) => reject(error));
}

function rejectThrottleState(state: ThrottleState, error: Error) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }

  const { rejectList } = state;
  state.resolveList = [];
  state.rejectList = [];
  state.latestInput = undefined;
  state.currentPromise = undefined;
  rejectList.forEach((reject) => reject(error));
}

export const temporalResource = defineResource({
  id: "globals.resources.temporal",
  tags: [globalTags.system],
  init: async (): Promise<TemporalResourceState> => {
    return {
      debounceStates: new WeakMap<TemporalMiddlewareConfig, DebounceState>(),
      throttleStates: new WeakMap<TemporalMiddlewareConfig, ThrottleState>(),
      trackedDebounceStates: new Set<DebounceState>(),
      trackedThrottleStates: new Set<ThrottleState>(),
      isDisposed: false,
    };
  },
  dispose: async (state: TemporalResourceState) => {
    state.isDisposed = true;
    const disposeError = createTemporalDisposedError();
    const trackedDebounceStates =
      state.trackedDebounceStates ?? new Set<DebounceState>();
    const trackedThrottleStates =
      state.trackedThrottleStates ?? new Set<ThrottleState>();

    trackedDebounceStates.forEach((debounceState) => {
      rejectDebounceState(debounceState, disposeError);
    });

    trackedThrottleStates.forEach((throttleState) => {
      rejectThrottleState(throttleState, disposeError);
    });

    trackedDebounceStates.clear();
    trackedThrottleStates.clear();
  },
});

/**
 * Debounce middleware: delays execution until `ms` has passed since the last call.
 * If multiple calls occur within the window, only the last one is executed,
 * and all callers receive the same result.
 */
export const debounceTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.debounce",
  dependencies: { state: temporalResource },
  async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const debounceStates = state.debounceStates;
    const trackedDebounceStates =
      state.trackedDebounceStates ??
      (state.trackedDebounceStates = new Set<DebounceState>());
    let debounceState = debounceStates.get(config);
    if (!debounceState) {
      debounceState = {
        resolveList: [],
        rejectList: [],
      };
      debounceStates.set(config, debounceState);
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

      if (state.isDisposed === true) {
        const disposeError = createTemporalDisposedError();
        rejectList.forEach((reject) => reject(disposeError));
        return;
      }

      try {
        const result = await next(latestInput);
        resolveList.forEach((resolve) => resolve(result));
      } catch (error) {
        rejectList.forEach((reject) => reject(error));
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
  id: "globals.middleware.task.throttle",
  dependencies: { state: temporalResource },
  async run({ task, next }, { state }, config: TemporalMiddlewareConfig) {
    if (state.isDisposed === true) {
      throw createTemporalDisposedError();
    }

    const throttleStates = state.throttleStates;
    const trackedThrottleStates =
      state.trackedThrottleStates ??
      (state.trackedThrottleStates = new Set<ThrottleState>());
    let throttleState = throttleStates.get(config);
    if (!throttleState) {
      throttleState = {
        lastExecution: 0,
        resolveList: [],
        rejectList: [],
      };
      throttleStates.set(config, throttleState);
      trackedThrottleStates.add(throttleState);
    }

    const now = Date.now();
    const remaining = config.ms - (now - throttleState.lastExecution);

    if (remaining <= 0) {
      let pendingResolves: Array<(value: any) => void> = [];
      let pendingRejects: Array<(error: any) => void> = [];

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
        pendingResolves.forEach((resolve) => resolve(result));
        return result;
      } catch (error) {
        pendingRejects.forEach((reject) => reject(error));
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
            rejectList.forEach((reject) => reject(disposeError));
            return;
          }

          try {
            const result = await next(latestInput);
            resolveList.forEach((resolve) => resolve(result));
          } catch (error) {
            rejectList.forEach((reject) => reject(error));
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
