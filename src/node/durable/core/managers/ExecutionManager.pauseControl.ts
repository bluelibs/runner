import { Match } from "../../../../tools/check";
import { EXECUTION_PAUSED_ABORT_REASON } from "../pauseInterruption";
import { ExecutionStatus, type Execution } from "../types";

/**
 * A pause as seen by live attempts. `pausedAtMs` is the stamp of that pause;
 * it is absent for legacy publishers and then every live attempt is aborted.
 */
export type ExecutionPauseState = {
  reason: string;
  pausedAtMs?: number;
};

/** Aborts a live attempt for pause unless it started after that pause. */
export type AbortPausedAttempt = (
  executionId: string,
  pause: ExecutionPauseState,
) => void;

export type PauseRequestedPayload = ExecutionPauseState & {
  executionId: string;
};

const pauseRequestedPayloadPattern = Match.compile(
  Match.ObjectIncluding({
    executionId: String,
    reason: String,
    pausedAtMs: Match.Optional(Number),
  }),
);

/**
 * Validates a `pause_requested` payload at the bus trust boundary. Malformed
 * payloads (including a non-numeric stamp) are ignored rather than trusted.
 */
export function parsePauseRequestedPayload(
  payload: unknown,
): PauseRequestedPayload | null {
  return pauseRequestedPayloadPattern.test(payload) ? payload : null;
}

export function getPauseState(
  execution: Execution<unknown, unknown> | null,
): ExecutionPauseState | null {
  if (!execution || execution.status !== ExecutionStatus.Paused) {
    return null;
  }

  return {
    reason: EXECUTION_PAUSED_ABORT_REASON,
    pausedAtMs: execution.pausedAt?.getTime(),
  };
}

/**
 * Whether a pause abort applies to an attempt. An attempt that started from
 * the very same pause stamp was launched after that pause was resumed, so a
 * late or re-issued abort for it must spare the attempt. Comparing stamps
 * (not wall clocks) keeps this independent of clock skew between workers.
 */
export function shouldPauseAbortAttempt(params: {
  pausedAtMs: number | undefined;
  attemptStartedFromPausedAtMs: number | undefined;
}): boolean {
  return (
    params.pausedAtMs === undefined ||
    params.pausedAtMs !== params.attemptStartedFromPausedAtMs
  );
}
