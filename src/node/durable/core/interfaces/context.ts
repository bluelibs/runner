import type { IEventDefinition } from "../../../../types/event";

export interface StepOptions {
  retries?: number;
  timeout?: number;
}

export interface IStepBuilder<T> extends PromiseLike<T> {
  up(fn: () => Promise<T>): this;
  down(fn: (result: T) => Promise<void>): this;
}

export interface IDurableContext {
  readonly executionId: string;
  readonly attempt: number;

  step<T>(stepId: string): IStepBuilder<T>;
  step<T>(stepId: string, fn: () => Promise<T>): Promise<T>;
  step<T>(
    stepId: string,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;

  sleep(durationMs: number): Promise<void>;

  /**
   * Suspend until an external signal is delivered via DurableService.signal().
   * The signal is memoized as a durable step under `__signal:<signalId>`.
   */
  waitForSignal<TPayload>(
    signal: string | IEventDefinition<TPayload>,
  ): Promise<TPayload>;
  waitForSignal<TPayload>(
    signal: string | IEventDefinition<TPayload>,
    options: { timeoutMs: number },
  ): Promise<{ kind: "signal"; payload: TPayload } | { kind: "timeout" }>;

  emit<TPayload>(
    event: string | { id: string },
    payload: TPayload,
  ): Promise<void>;

  rollback(): Promise<void>;
}

export class SuspensionSignal extends Error {
  constructor(public readonly reason: "sleep" | "yield" | "timeout") {
    super(`Execution suspended: ${reason}`);
    this.name = "SuspensionSignal";
  }
}
