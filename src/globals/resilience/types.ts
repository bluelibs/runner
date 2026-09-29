/** Configuration for opt-in Redis-backed task resilience. */
export interface ResilienceConfig {
  /** Shared Redis namespace. Use a different namespace for each environment. */
  namespace: string;
  /** Redis connection URL. The resource owns and closes its connection. */
  redis: string;
  /** Permit and half-open probe lease duration in milliseconds. Default: 30000. */
  leaseMs?: number;
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

/** Portable internal contract; only the Node entry point provides Redis support. */
export interface Resilience {
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
  ): Promise<T>;
  /** Stop owned work and close the backend connection without clearing shared state. */
  dispose(): Promise<void>;
}
