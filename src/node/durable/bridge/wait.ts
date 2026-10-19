import { throwCancellationErrorFromSignal } from "../../../tools/abortSignals";

/** Cancels only the caller's wait; accepted durable work remains recoverable. */
export async function waitForEvent<T>(
  result: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return result;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => {
      try {
        throwCancellationErrorFromSignal(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([interrupted, result]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
