import type { IEventDefinition } from "../../../../types/event";
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
  /** Timeout in milliseconds. If provided, returns a discriminated union with kind. */
  timeoutMs?: number;
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
}

/**
 * Options for emit operations.
 */
export interface EmitOptions {
  /** Explicit step ID for replay stability. If not provided, an auto-indexed ID is used. */
  stepId?: string;
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
   * Suspend until an external signal is delivered via DurableService.signal().
   * The signal is memoized as a durable step under `__signal:<signalId>[:index]`.
   * Use options.stepId to provide a stable identifier for replay safety.
   */
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
  ): Promise<TPayload>;
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions & { timeoutMs: number },
  ): Promise<{ kind: "signal"; payload: TPayload } | { kind: "timeout" }>;
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions,
  ): Promise<TPayload>;

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
