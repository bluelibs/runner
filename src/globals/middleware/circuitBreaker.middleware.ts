import { defineTaskMiddleware } from "../../define";

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

interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failures: number;
  lastFailureTime: number;
}

const statusMap = new Map<string, CircuitBreakerStatus>();

export const circuitBreakerMiddleware = defineTaskMiddleware({
  id: "globals.middleware.circuitBreaker",
  async run({ task, next }, _deps, config: CircuitBreakerMiddlewareConfig) {
    const taskId = task!.definition.id;
    const failureThreshold = config.failureThreshold ?? 5;
    const resetTimeout = config.resetTimeout ?? 30000;

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
        throw new CircuitBreakerOpenError(
          `Circuit is OPEN for task "${taskId}"`,
        );
      }
    }

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
