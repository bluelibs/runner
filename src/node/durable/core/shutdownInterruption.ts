import { cancellationError } from "../../../errors";
import { runtimeShutdownAbortReason } from "../../../tools/runtimeShutdownAbortReason";

/**
 * Internal durable cancellation reason used when Runner's abort window asks a
 * live attempt to stop now and resume on the next runtime.
 */
export const durableShutdownInterruptionReason = runtimeShutdownAbortReason;

export function isDurableShutdownInterruptionError(
  error: unknown,
  expectedReason: string | null,
): boolean {
  return (
    expectedReason !== null &&
    cancellationError.is(error, { reason: expectedReason })
  );
}
