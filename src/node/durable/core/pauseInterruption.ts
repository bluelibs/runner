import { cancellationError } from "../../../errors";

/**
 * Abort reason used when a live attempt is stopped for pause. Deliberately
 * distinct from the shutdown-interruption reason so pause aborts are never
 * mistaken for cooperative shutdown drains (and vice versa).
 */
export const EXECUTION_PAUSED_ABORT_REASON = "Execution paused";

/**
 * Stops the current attempt because its execution is paused. It is the same
 * cancellation error an aborted step raises from the pause signal, so the
 * attempt runner recognises both paths as one parked outcome.
 */
export function throwDurablePauseInterruption(): never {
  return cancellationError.throw({ reason: EXECUTION_PAUSED_ABORT_REASON });
}

/**
 * Whether an error is the pause interruption: the attempt was parked, not
 * failed, so it must neither consume a retry nor fail the execution.
 */
export function isDurablePauseInterruptionError(error: unknown): boolean {
  return cancellationError.is(error, { reason: EXECUTION_PAUSED_ABORT_REASON });
}
