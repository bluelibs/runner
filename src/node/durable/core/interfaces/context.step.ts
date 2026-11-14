import type { IDurableContext, IStepBuilder } from "./context";
import type { AnyTask } from "../../../../types/task";
import type {
  ExtractTaskInput,
  ResolveTaskOutput,
} from "../../../../types/utilities";
import type { DurableStepId } from "../ids";
import type { DurableWorkflowRateLimit } from "../../tags/durableWorkflow.tag";

/** Named concurrent-callback cap shared by selected durable steps. */
export interface DurableStepConcurrencyLimit {
  /** Shared pool key. Defaults to the persisted workflow key and explicit step ID. */
  key?: string;
  /** Maximum simultaneous live callbacks across workers sharing the durable store. */
  limit: number;
  /** Concurrent caps cannot also specify a fixed-window duration. */
  windowMs?: never;
  /** Concurrent caps cannot also specify a fixed-window start count. */
  max?: never;
}

/** Named fixed-window callback-start limit shared by selected durable steps. */
export interface DurableStepRateLimit extends DurableWorkflowRateLimit {
  /** Fixed-window policies cannot also specify a simultaneous callback cap. */
  limit?: never;
  /** Shared pool key. Defaults to the persisted workflow key and explicit step ID. */
  key?: string;
}

/** Store-coordinated step concurrency: numeric cap, named cap, or fixed window. */
export type DurableStepConcurrency =
  | number
  | DurableStepConcurrencyLimit
  | DurableStepRateLimit;

/** Controls retries, timeout, and global concurrency for a durable step. */
export interface StepOptions {
  /** Number of additional callback attempts after a failure. */
  retries?: number;
  /** Callback timeout in milliseconds. */
  timeout?: number;
  /** Acquired for each live callback attempt; cached replay skips acquisition. */
  concurrency?: DurableStepConcurrency;
  /** Maximum milliseconds without a persisted step heartbeat. Opt-in; must be positive. */
  heartbeatTimeoutMs?: number;
}

/**
 * Live execution controls available to a running durable step body.
 */
export interface DurableStepRunContext {
  /** Signals attempt cancellation; concurrency-controlled callbacks also receive timeout and lease loss. */
  signal: AbortSignal;
}

/** Additive controls supplied by Runner; the legacy run-context interface remains assignable. */
export interface DurableStepContext extends DurableStepRunContext {
  /** Stable execution/step identity for downstream deduplication, unchanged by retries. */
  readonly idempotencyKey: string;
  /** One-based callback attempt within the workflow attempt. */
  readonly attempt: number;
  /** Persists resumable progress; rejects after this callback loses authority. */
  heartbeat<T>(progress: T): Promise<void>;
  /** Reads a cloned copy of this step's last persisted progress. */
  getProgress<T>(): T | undefined;
}

/** Builder controls supplied by built-in workflow runtimes; legacy builders remain supported. */
export interface IDurableStepBuilder<T> extends IStepBuilder<T> {
  /** Runs the effect with persisted progress and downstream idempotency controls. */
  up(fn: (context: DurableStepContext) => Promise<T>): this;
}

/** Full built-in workflow toolkit, extending the legacy custom-context contract additively. */
export interface IDurableWorkflowContext extends IDurableContext {
  /** Builds a checkpoint with progress-aware callback controls. */
  step<T>(stepId: string | DurableStepId<T>): IDurableStepBuilder<T>;
  /** Runs a memoized callback with progress and idempotency controls. */
  step<T>(
    stepId: string | DurableStepId<T>,
    fn: (context: DurableStepContext) => Promise<T>,
  ): Promise<T>;
  /** Runs a callback with optional retry, timeout, concurrency and heartbeat controls. */
  step<T>(
    stepId: string | DurableStepId<T>,
    options: StepOptions,
    fn: (context: DurableStepContext) => Promise<T>,
  ): Promise<T>;
  /** Executes a typed Runner task as a memoized step, using the runtime's normal DI and middleware. */
  step<TTask extends AnyTask>(
    stepId: string,
    task: TTask,
    ...args: ExtractTaskInput<TTask> extends undefined | void
      ? [input?: ExtractTaskInput<TTask>, options?: StepOptions]
      : [input: ExtractTaskInput<TTask>, options?: StepOptions]
  ): Promise<ResolveTaskOutput<TTask>>;
}
