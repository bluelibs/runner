/**
 * Options for workflow-state calls.
 */
export interface DurableStateOptions {
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
}

/**
 * Workflow-owned typed state: one record per execution, carried across
 * continue-as-new and never across restart. Every call is a persisted
 * internal step (it counts toward `info().stepCount` and history), keyed by
 * `options.stepId` or else by call order, so replay is deterministic like any
 * other durable operation.
 */
export interface IDurableStateContext {
  /**
   * Shallow-merges a plain-object patch into existing plain-object state.
   * Throws when state is unset or not a plain object, so a partial value is
   * never stored as the full `T`: initialize with `replaceState()` first.
   * Memoized like a step: replay skips writes that were already applied.
   */
  setState<T extends object>(
    patch: Partial<T> & Record<string, unknown>,
    options?: DurableStateOptions,
  ): Promise<void>;

  /**
   * Replaces the workflow-owned typed state record wholesale.
   * Memoized like a step: replay skips writes that were already applied.
   */
  replaceState<T>(next: T, options?: DurableStateOptions): Promise<void>;

  /**
   * Reads the workflow-owned typed state as this point of the workflow saw it
   * (memoized, so replay returns the historical value).
   * Resolves `undefined` until the workflow first sets state.
   */
  getState<T>(options?: DurableStateOptions): Promise<T | undefined>;
}
