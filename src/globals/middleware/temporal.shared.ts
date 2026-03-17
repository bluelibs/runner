type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface DebounceState {
  timeoutId?: TimeoutHandle;
  latestInput?: unknown;
  resolveList: ((value: unknown) => void)[];
  rejectList: ((error: unknown) => void)[];
  key: string;
  scheduledAt?: number;
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
  debounceStateMaps?: Map<TConfig, Map<string, DebounceState>>;
  throttleStateMaps?: Map<TConfig, Map<string, ThrottleState>>;
  trackedDebounceStates: Set<DebounceState>;
  trackedThrottleStates: Set<ThrottleState>;
  disposeCleanupTimer?: () => void;
  registerDebounceStateMap?: (
    config: TConfig,
    keyedStates: Map<string, DebounceState>,
  ) => void;
  registerThrottleStateMap?: (
    config: TConfig,
    keyedStates: Map<string, ThrottleState>,
  ) => void;
  sweepIdleStates?: (now: number) => void;
  isDisposed: boolean;
}

export function rejectDebounceState(state: DebounceState, error: Error) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }

  const { rejectList } = state;
  state.resolveList = [];
  state.rejectList = [];
  state.latestInput = undefined;
  state.scheduledAt = undefined;
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

export function pruneStaleDebounceStates(
  keyedStates: Map<string, DebounceState>,
  trackedStates: Set<DebounceState>,
  now: number,
  waitMs: number,
) {
  for (const [key, debounceState] of keyedStates) {
    const isStale =
      debounceState.timeoutId === undefined &&
      debounceState.resolveList.length === 0 &&
      debounceState.rejectList.length === 0 &&
      debounceState.latestInput === undefined &&
      debounceState.scheduledAt !== undefined &&
      now - debounceState.scheduledAt >= waitMs;

    if (isStale) {
      trackedStates.delete(debounceState);
      keyedStates.delete(key);
    }
  }
}
