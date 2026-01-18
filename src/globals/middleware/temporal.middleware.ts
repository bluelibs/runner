import { defineTaskMiddleware } from "../../define";

export interface TemporalMiddlewareConfig {
  ms: number;
}

interface DebounceState {
  timeoutId?: NodeJS.Timeout;
  latestInput?: any;
  resolveList: ((value: any) => void)[];
  rejectList: ((error: any) => void)[];
}

const debounceStates = new WeakMap<TemporalMiddlewareConfig, DebounceState>();

/**
 * Debounce middleware: delays execution until `ms` has passed since the last call.
 * If multiple calls occur within the window, only the last one is executed,
 * and all callers receive the same result.
 */
export const debounceTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.debounce",
  async run({ task, next }, _deps, config: TemporalMiddlewareConfig) {
    let state = debounceStates.get(config);
    if (!state) {
      state = {
        resolveList: [],
        rejectList: [],
      };
      debounceStates.set(config, state);
    }

    state.latestInput = task.input;

    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }

    const promise = new Promise((resolve, reject) => {
      state!.resolveList.push(resolve);
      state!.rejectList.push(reject);
    });

    state.timeoutId = setTimeout(async () => {
      const { resolveList, rejectList, latestInput } = state!;
      state!.timeoutId = undefined;
      state!.resolveList = [];
      state!.rejectList = [];
      state!.latestInput = undefined;

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

interface ThrottleState {
  lastExecution: number;
  timeoutId?: NodeJS.Timeout;
  latestInput?: any;
  resolveList: ((value: any) => void)[];
  rejectList: ((error: any) => void)[];
  currentPromise?: Promise<any>;
}

const throttleStates = new WeakMap<TemporalMiddlewareConfig, ThrottleState>();

/**
 * Throttle middleware: ensures execution at most once every `ms`.
 * If calls occur within the window, the last one is scheduled for the end of the window.
 */
export const throttleTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.throttle",
  async run({ task, next }, _deps, config: TemporalMiddlewareConfig) {
    let state = throttleStates.get(config);
    if (!state) {
      state = {
        lastExecution: 0,
        resolveList: [],
        rejectList: [],
      };
      throttleStates.set(config, state);
    }

    const now = Date.now();
    const remaining = config.ms - (now - state.lastExecution);

    if (remaining <= 0) {
      let pendingResolves: Array<(value: any) => void> = [];
      let pendingRejects: Array<(error: any) => void> = [];

      if (state.timeoutId) {
        // This can happen if a scheduled timeout from the previous window is
        // still pending (eg: event-loop stalls). Cancel it and settle its callers
        // using the immediate execution result.
        pendingResolves = state.resolveList;
        pendingRejects = state.rejectList;

        clearTimeout(state.timeoutId);
        state.timeoutId = undefined;
        state.resolveList = [];
        state.rejectList = [];
        state.currentPromise = undefined;
        state.latestInput = undefined;
      }
      state.lastExecution = now;
      try {
        const result = await next(task.input);
        pendingResolves.forEach((resolve) => resolve(result));
        return result;
      } catch (error) {
        pendingRejects.forEach((reject) => reject(error));
        throw error;
      }
    } else {
      state.latestInput = task.input;
      if (!state.timeoutId) {
        state.currentPromise = new Promise((resolve, reject) => {
          state!.resolveList.push(resolve);
          state!.rejectList.push(reject);
        });

        state.timeoutId = setTimeout(async () => {
          const { resolveList, rejectList, latestInput } = state!;
          state!.timeoutId = undefined;
          state!.lastExecution = Date.now();
          state!.resolveList = [];
          state!.rejectList = [];
          state!.currentPromise = undefined;

          try {
            const result = await next(latestInput);
            resolveList.forEach((resolve) => resolve(result));
          } catch (error) {
            rejectList.forEach((reject) => reject(error));
          }
        }, remaining);
      } else {
        // Update input for the scheduled execution
        state.latestInput = task.input;
        return new Promise((resolve, reject) => {
          state!.resolveList.push(resolve);
          state!.rejectList.push(reject);
        });
      }
      return state.currentPromise;
    }
  },
});
