import type { ConcurrencyWaitOptions } from "../middleware/concurrency/wait";
/** Configuration for opt-in Redis-backed task resilience. */
export interface ResilienceConfig {
  /** Shared Redis namespace. Use a different namespace for each environment. */
  namespace: string;
  /** Redis connection URL. The resource owns and closes its connection. */
  redis: string;
  /** Permit and half-open probe lease duration in milliseconds. Positive integer up to 2147483647; default: 30000. */
  leaseMs?: number;
}

/** Named distributed pool shared with unscoped concurrency middleware using the same key. */
export interface ResilienceSemaphoreConfig extends ConcurrencyWaitOptions {
  /** Non-empty shared pool name within this resilience namespace. */
  key: string;
  /** Maximum simultaneous permit holders across replicas. */
  limit: number;
}

/** Cancellation for an individual distributed semaphore invocation. */
export interface ResilienceSemaphoreRunOptions {
  /** Cancels acquisition and cooperatively signals running work. */
  signal?: AbortSignal;
}

/** Reusable distributed semaphore; its resilience resource owns disposal. */
export interface ResilienceSemaphore {
  /** Run under a renewable permit. Observe the signal for cancellation, shutdown, and lease loss. */
  withPermit<T>(
    run: (signal: AbortSignal) => Promise<T>,
    options?: ResilienceSemaphoreRunOptions,
  ): Promise<T>;
}

/** Atomic fixed-window admission result. */
export interface RateAdmission {
  /** Whether this invocation consumed an allowance. */
  allowed: boolean;
  /** Remaining allowances after this decision. */
  remaining: number;
  /** Redis-clock window expiry, as Unix milliseconds. */
  resetTime: number;
}

/** Observable circuit state returned by the shared backend. */
export interface CircuitSnapshot {
  /** Current circuit phase. */
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  /** Consecutive recorded failures. */
  failures: number;
}

/** Ownership token for an admitted circuit invocation. */
export interface CircuitAdmission extends CircuitSnapshot {
  /** False when the circuit rejects the invocation. */
  allowed: boolean;
  /** Generation captured at admission; stale outcomes cannot change a new circuit. */
  generation: string;
}

/** Shared resilience service; only the Node entry point provides Redis support. */
export interface Resilience {
  /** Create a reusable handle to a named distributed pool; does not acquire a permit. */
  semaphore(config: ResilienceSemaphoreConfig): ResilienceSemaphore;
  /** Consume an allowance atomically within a task's identity-scoped partition. */
  rateLimit(
    taskId: string,
    key: string,
    max: number,
    windowMs: number,
    maxKeys?: number,
  ): Promise<RateAdmission>;
  /** Admit a call or one leased half-open probe. */
  enterCircuit(
    taskId: string,
    threshold: number,
    resetMs: number,
  ): Promise<CircuitAdmission>;
  /** Record an admitted call's outcome, ignoring stale generations. */
  settleCircuit(
    taskId: string,
    admission: CircuitAdmission,
    success: boolean,
  ): Promise<CircuitSnapshot>;
  /** Execute under a renewable distributed permit and propagate ownership loss. */
  withPermit<T>(
    key: string,
    limit: number,
    signal: AbortSignal | undefined,
    abort: (reason: Error) => void,
    run: () => Promise<T>,
    wait?: ConcurrencyWaitOptions,
  ): Promise<T>;
  /** Stop owned work and close the backend connection without clearing shared state. */
  dispose(): Promise<void>;
}
