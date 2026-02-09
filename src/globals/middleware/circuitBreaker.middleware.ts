import { defineTaskMiddleware, defineResource } from "../../define";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalTags } from "../globalTags";

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
export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failures: number;
  lastFailureTime: number;
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
});

export const circuitBreakerMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.circuitBreaker",
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
      };
      statusMap.set(taskId, status);
    }

    const now = Date.now();

    // Handle OPEN state transition to HALF_OPEN
    if (status.state === CircuitBreakerState.OPEN) {
      if (now - status.lastFailureTime >= resetTimeout) {
        status.state = CircuitBreakerState.HALF_OPEN;
      } else {
        // Set journal values before throwing
        journal.set(journalKeys.state, status.state, { override: true });
        journal.set(journalKeys.failures, status.failures, { override: true });
        throw new CircuitBreakerOpenError(
          `Circuit is OPEN for task "${taskId}"`,
        );
      }
    }

    // Set journal values before executing
    journal.set(journalKeys.state, status.state, { override: true });
    journal.set(journalKeys.failures, status.failures, { override: true });

    try {
      const result = await next(task!.input);

      // If successful, we reset the failures counter
      if (
        status.state === CircuitBreakerState.HALF_OPEN ||
        status.state === CircuitBreakerState.CLOSED
      ) {
        status.failures = 0;
      }

      if (status.state === CircuitBreakerState.HALF_OPEN) {
        status.state = CircuitBreakerState.CLOSED;
      }

      return result;
    } catch (error) {
      status.failures++;
      status.lastFailureTime = Date.now();

      if (
        status.state === CircuitBreakerState.CLOSED &&
        status.failures >= failureThreshold
      ) {
        status.state = CircuitBreakerState.OPEN;
      } else if (status.state === CircuitBreakerState.HALF_OPEN) {
        status.state = CircuitBreakerState.OPEN;
      }

      throw error;
    }
  },
});
