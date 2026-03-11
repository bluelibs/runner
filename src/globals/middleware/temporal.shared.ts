type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface DebounceState {
  timeoutId?: TimeoutHandle;
  latestInput?: unknown;
  resolveList: ((value: unknown) => void)[];
  rejectList: ((error: unknown) => void)[];
  key: string;
}

export interface ThrottleState {
  lastExecution: number;
  timeoutId?: TimeoutHandle;
  latestInput?: unknown;
  resolveList: ((value: unknown) => void)[];
  rejectList: ((error: unknown) => void)[];
  currentPromise?: Promise<unknown>;
  key: string;
}

export interface TemporalResourceState<TConfig extends object = object> {
  debounceStates: WeakMap<TConfig, Map<string, DebounceState>>;
  throttleStates: WeakMap<TConfig, Map<string, ThrottleState>>;
  trackedDebounceStates: Set<DebounceState>;
  trackedThrottleStates: Set<ThrottleState>;
  isDisposed: boolean;
}

const TEMPORAL_STATE_PRUNE_THRESHOLD = 1_000;

export function rejectDebounceState(state: DebounceState, error: Error) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }

  const { rejectList } = state;
  state.resolveList = [];
  state.rejectList = [];
  state.latestInput = undefined;
  rejectList.forEach((reject) => {
    reject(error);
  });
}

export function rejectThrottleState(state: ThrottleState, error: Error) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }

  const { rejectList } = state;
  state.resolveList = [];
  state.rejectList = [];
  state.latestInput = undefined;
  state.currentPromise = undefined;
  rejectList.forEach((reject) => {
    reject(error);
  });
}

export function pruneIdleThrottleStates(
  keyedStates: Map<string, ThrottleState>,
  trackedStates: Set<ThrottleState>,
  now: number,
  windowMs: number,
) {
  if (keyedStates.size < TEMPORAL_STATE_PRUNE_THRESHOLD) {
    return;
  }

  for (const [key, throttleState] of keyedStates) {
    const isIdle =
      throttleState.timeoutId === undefined &&
      throttleState.currentPromise === undefined &&
      throttleState.resolveList.length === 0 &&
      throttleState.rejectList.length === 0 &&
      now - throttleState.lastExecution >= windowMs;

    if (isIdle) {
      trackedStates.delete(throttleState);
      keyedStates.delete(key);
    }
  }
}
