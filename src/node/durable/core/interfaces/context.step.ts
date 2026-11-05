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
}

/**
 * Live execution controls available to a running durable step body.
 */
export interface DurableStepRunContext {
  /** Signals attempt cancellation; concurrency-controlled callbacks also receive timeout and lease loss. */
  signal: AbortSignal;
}
