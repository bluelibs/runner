import { defineTaskMiddleware, defineResource } from "../../define";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalTags } from "../globalTags";
import { RunnerError } from "../../definers/defineError";
import { middlewareCircuitBreakerOpenError, RunnerErrorId } from "../../errors";

/**
 * States of the Circuit Breaker
 */
export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

/**
 * Configuration for the Circuit Breaker middleware
 */
export interface CircuitBreakerMiddlewareConfig {
  /**
   * Number of failures before tripping the circuit
   * @default 5
   */
  failureThreshold?: number;
  /**
   * Time in milliseconds before transitioning from OPEN to HALF_OPEN
   * @default 30000 (30 seconds)
   */
  resetTimeout?: number;
}

/**
 * Error thrown when the circuit is OPEN
 */
export class CircuitBreakerOpenError extends RunnerError<{ message: string }> {
  constructor(message: string) {
    super(
      RunnerErrorId.MiddlewareCircuitBreakerOpen,
      message,
      { message },
      middlewareCircuitBreakerOpenError.httpCode,
    );
  }
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failures: number;
  lastFailureTime: number;
  halfOpenProbeInFlight: boolean;
}

/**
 * Journal keys exposed by the circuit breaker middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Current state of the circuit breaker (CLOSED, OPEN, or HALF_OPEN) */
  state: journalHelper.createKey<CircuitBreakerState>(
    "globals.middleware.task.circuitBreaker.state",
  ),
  /** Current failure count */
  failures: journalHelper.createKey<number>(
    "globals.middleware.task.circuitBreaker.failures",
  ),
} as const;

export const circuitBreakerResource = defineResource({
  id: "globals.resources.circuitBreaker",
  tags: [globalTags.system],
  init: async () => {
    return {
      statusMap: new Map<string, CircuitBreakerStatus>(),
    };
  },
  dispose: async (state) => {
    state.statusMap.clear();
  },
});

export const circuitBreakerMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.circuitBreaker",
  throws: [middlewareCircuitBreakerOpenError],
  dependencies: { state: circuitBreakerResource },
  async run(
    { task, next, journal },
    { state },
    config: CircuitBreakerMiddlewareConfig,
  ) {
    const taskId = task!.definition.id;
    const failureThreshold = config.failureThreshold ?? 5;
    const resetTimeout = config.resetTimeout ?? 30000;

    const { statusMap } = state;

    let status = statusMap.get(taskId);
    if (!status) {
      status = {
        state: CircuitBreakerState.CLOSED,
        failures: 0,
        lastFailureTime: 0,
        halfOpenProbeInFlight: false,
      };
      statusMap.set(taskId, status);
    }

    const now = Date.now();
    const syncJournal = () => {
      journal.set(journalKeys.state, status.state, { override: true });
      journal.set(journalKeys.failures, status.failures, { override: true });
    };

    // Handle OPEN state transition to HALF_OPEN
    if (status.state === CircuitBreakerState.OPEN) {
      if (now - status.lastFailureTime >= resetTimeout) {
        status.state = CircuitBreakerState.HALF_OPEN;
        status.halfOpenProbeInFlight = false;
      } else {
        // Set journal values before throwing
        syncJournal();
        throw new CircuitBreakerOpenError(
          `Circuit is OPEN for task "${taskId}"`,
        );
      }
    }

    let acquiredHalfOpenProbe = false;
    if (status.state === CircuitBreakerState.HALF_OPEN) {
      if (status.halfOpenProbeInFlight) {
        syncJournal();
        throw new CircuitBreakerOpenError(
          `Circuit is HALF_OPEN for task "${taskId}" (probe in progress)`,
        );
      }
      status.halfOpenProbeInFlight = true;
      acquiredHalfOpenProbe = true;
    }

    // Set journal values before executing
    syncJournal();

    try {
      const result = await next(task!.input);

      // If successful, we reset the failures counter
      if (status.state === CircuitBreakerState.CLOSED) {
        status.failures = 0;
      }

      if (status.state === CircuitBreakerState.HALF_OPEN) {
        status.state = CircuitBreakerState.CLOSED;
        status.failures = 0;
        status.lastFailureTime = 0;
      }

      syncJournal();
      return result;
    } catch (error) {
      if (status.state === CircuitBreakerState.HALF_OPEN) {
        status.state = CircuitBreakerState.OPEN;
        status.failures = Math.max(status.failures + 1, failureThreshold);
        status.lastFailureTime = Date.now();
      } else {
        status.failures++;
        status.lastFailureTime = Date.now();

        if (status.state === CircuitBreakerState.CLOSED) {
          if (status.failures >= failureThreshold) {
            status.state = CircuitBreakerState.OPEN;
          }
        }
      }

      syncJournal();
      throw error;
    } finally {
      if (acquiredHalfOpenProbe) {
        status.halfOpenProbeInFlight = false;
      }
    }
  },
});
