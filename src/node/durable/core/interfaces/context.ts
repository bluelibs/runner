import type { IEventDefinition } from "../../../../types/event";
import type { AnyTask } from "../../../../types/task";
import type {
  ExtractTaskInput,
  ResolveTaskOutput,
} from "../../../../types/utilities";
import type { DurableStepId } from "../ids";

export interface StepOptions {
  retries?: number;
  timeout?: number;
}

/**
 * Options for sleep operations.
 * Use `stepId` to provide a stable identifier that survives code refactoring.
 */
export interface SleepOptions {
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
}

/**
 * Options for waitForSignal operations.
 */
export interface SignalOptions {
  /** Timeout in milliseconds. If provided, the wait may resolve as `{ kind: "timeout" }`. */
  timeoutMs?: number;
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
}

export type WaitForSignalResult<TPayload> =
  | { kind: "signal"; payload: TPayload }
  | { kind: "timeout" };

/**
 * Options for waiting on another workflow execution to complete.
 */
export interface WaitForExecutionOptions {
  /** Timeout in milliseconds. If provided, returns a discriminated union with kind. */
  timeoutMs?: number;
  /**
   * Explicit step ID for replay stability. When omitted, a deterministic step id
   * is derived from the waited execution id.
   */
  stepId?: string;
}

/**
 * Options for emit operations.
 */
export interface EmitOptions {
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
}

/**
 * Options for starting a child workflow from within a durable workflow.
 */
export interface WorkflowOptions {
  /** Optional workflow runtime timeout forwarded to the child execution. */
  timeout?: number;
  /** Optional execution priority forwarded to the child start path. */
  priority?: number;
  /**
   * Optional explicit idempotency key override.
   * When omitted, `workflow()` derives a deterministic key from
   * `parentExecutionId + stepId`.
   */
  idempotencyKey?: string;
}

/**
 * A single branch in a durable switch expression.
 *
 * `id` identifies the branch for replay; `match` tests whether this branch applies;
 * `run` executes the branch logic (only on first evaluation, cached on replay).
 */
export interface SwitchBranch<TValue, TResult> {
  /** Stable identifier for this branch. Persisted for replay. */
  id: string;
  /** Predicate that selects this branch based on the switch value. */
  match: (value: TValue) => boolean;
  /** Logic to execute when this branch is selected. */
  run: (value: TValue) => Promise<TResult>;
}

export interface IStepBuilder<T> extends PromiseLike<T> {
  up(fn: () => Promise<T>): this;
  down(fn: (result: T) => Promise<void>): this;
}

export interface IDurableContext {
  readonly executionId: string;
  readonly attempt: number;

  step<T>(stepId: string): IStepBuilder<T>;
  step<T>(stepId: DurableStepId<T>): IStepBuilder<T>;
  step<T>(stepId: string, fn: () => Promise<T>): Promise<T>;
  step<T>(stepId: DurableStepId<T>, fn: () => Promise<T>): Promise<T>;
  step<T>(
    stepId: string,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
  step<T>(
    stepId: DurableStepId<T>,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;

  sleep(durationMs: number, options?: SleepOptions): Promise<void>;

  /**
   * Start a child durable workflow in a replay-safe way.
   *
   * `workflow()` behaves like a durable `step(...)` around `durable.start(...)`:
   * it memoizes the returned child execution id, always forwards
   * `parentExecutionId: this.executionId`, and auto-derives a deterministic
   * idempotency key from `stepId` when one is not explicitly provided.
   */
  workflow<TTask extends AnyTask>(
    stepId: string,
    task: TTask,
    ...args: ExtractTaskInput<TTask> extends undefined | void
      ? [input?: ExtractTaskInput<TTask>, options?: WorkflowOptions]
      : [input: ExtractTaskInput<TTask>, options?: WorkflowOptions]
  ): Promise<string>;

  /**
   * Suspend until an external signal is delivered via DurableService.signal().
   * Accepted live-execution signals are retained at the execution level, while
   * consumed waits are memoized as durable steps under `__signal:<signalId>[:index]`.
   * Unawaited signals are queued per signal type and consumed in FIFO order.
   * Duplicate queued payloads are de-duplicated using serialized payload identity.
   * Use options.stepId to provide a stable identifier for replay safety.
   */
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options?: SignalOptions,
  ): Promise<WaitForSignalResult<TPayload>>;

  /**
   * Suspend until another durable execution reaches a terminal state.
   *
   * Intended for parent/child workflow orchestration when a child execution id
   * was produced earlier inside a replay-safe `workflow(...)` or `step(...)`.
   * The `task` argument drives type inference and is also checked against the
   * stored durable execution identity; the wait itself is still keyed by the
   * supplied `executionId`.
   *
   * - completed child executions return their result
   * - failed / cancelled / compensation_failed child executions throw
   * - waiting on `this.executionId` throws immediately to avoid deadlocks
   * - `timeoutMs` changes the return type to a timeout union
   * - if the parent is already suspended, child completion can still resume the
   *   wait during durable cooldown/drain before final disposal closes adapters
   *
   * Use `options.stepId` to keep the wait stable across refactors. When omitted,
   * the waited execution id is used to derive a deterministic internal step id.
   */
  waitForExecution<TTask extends AnyTask>(
    task: TTask,
    executionId: string,
  ): Promise<ResolveTaskOutput<TTask>>;
  waitForExecution<TTask extends AnyTask>(
    task: TTask,
    executionId: string,
    options: WaitForExecutionOptions & { timeoutMs: number },
  ): Promise<
    { kind: "completed"; data: ResolveTaskOutput<TTask> } | { kind: "timeout" }
  >;
  waitForExecution<TTask extends AnyTask>(
    task: TTask,
    executionId: string,
    options: WaitForExecutionOptions,
  ): Promise<ResolveTaskOutput<TTask>>;

  emit<TPayload>(
    event: IEventDefinition<TPayload>,
    payload: TPayload,
    options?: EmitOptions,
  ): Promise<void>;

  /**
   * Append a custom audit entry for observability and debugging.
   * This is a no-op if audit is disabled or the store does not support it.
   */
  note(message: string, meta?: Record<string, unknown>): Promise<void>;

  /**
   * Replay-safe branching primitive.
   *
   * Evaluates `branches` against `value` to find the first matching branch.
   * The matched branch's `id` and result are persisted; on replay the matchers
   * are skipped and the cached result is returned directly.
   *
   * Throws if no branch matches and no `defaultBranch` is provided.
   */
  switch<TValue, TResult>(
    stepId: string,
    value: TValue,
    branches: SwitchBranch<TValue, TResult>[],
    defaultBranch?: Omit<SwitchBranch<TValue, TResult>, "match">,
  ): Promise<TResult>;

  rollback(): Promise<void>;
}

/**
 * Internal control-flow signal used to suspend a durable execution without failing it.
 *
 * `DurableContext` throws this error to indicate "pause here and resume later":
 * - `"sleep"`: durable sleep timer was scheduled
 * - `"yield"`: waiting for a signal (or signal-timeout timer) to complete
 *
 * `ExecutionManager` treats this as a normal suspension and will not mark the execution
 * as failed; instead it schedules a resume via timers/queue depending on configuration.
 */
export class SuspensionSignal extends Error {
  constructor(public readonly reason: "sleep" | "yield" | "timeout") {
    super(`Execution suspended: ${reason}`);
    this.name = "SuspensionSignal";
  }
}
