import { cancellationError } from "../../../errors";

/**
 * Whether an error is the cooperative shutdown-abort interruption Runner raises
 * when its drain budget expires and it asks a live attempt to stop now and
 * resume on the next runtime. `expectedReason` is the latched abort reason from
 * the cancellation controller (null when no shutdown interruption is active).
 */
export function isDurableShutdownInterruptionError(
  error: unknown,
  expectedReason: string | null,
): boolean {
  return (
    expectedReason !== null &&
    cancellationError.is(error, { reason: expectedReason })
  );
}
