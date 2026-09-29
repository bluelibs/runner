import type { Resilience, CircuitSnapshot } from "./types";
import type { ExecutionJournal } from "../../types/executionJournal";
import {
  circuitBreakerMiddleware,
  CircuitBreakerState,
  CircuitBreakerOpenError,
} from "../middleware/circuitBreaker.middleware";

/** Keeps shared circuit transitions aligned with the existing middleware journal. */
export async function runSharedCircuit<T>(
  backend: Resilience,
  taskId: string,
  threshold: number,
  resetMs: number,
  journal: ExecutionJournal,
  run: () => Promise<T>,
): Promise<T> {
  const sync = (state: CircuitSnapshot) => {
    journal.set(
      circuitBreakerMiddleware.journalKeys.state,
      CircuitBreakerState[state.state],
      { override: true },
    );
    journal.set(circuitBreakerMiddleware.journalKeys.failures, state.failures, {
      override: true,
    });
  };
  const admission = await backend.enterCircuit(taskId, threshold, resetMs);
  sync(admission);
  if (!admission.allowed)
    throw new CircuitBreakerOpenError(
      `Circuit is ${admission.state} for task "${taskId}"`,
    );
  let result: T;
  try {
    result = await run();
  } catch (error) {
    sync(await backend.settleCircuit(taskId, admission, false));
    throw error;
  }
  sync(await backend.settleCircuit(taskId, admission, true));
  return result;
}
