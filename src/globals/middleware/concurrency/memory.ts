import { Semaphore } from "../../../models/Semaphore";
import { semaphoreAcquireTimeoutError } from "../../../errors";
import { createCancellationErrorFromSignal } from "../../../tools/abortSignals";
import { assertQueueAvailable, type ConcurrencyWaitOptions } from "./wait";
import { middlewareConcurrencyWaitTimeoutError } from "./errors";

/** Checks and enqueueing happen without yielding, so queue capacity cannot be oversubscribed. */
export async function withMemoryPermit<T>(
  semaphore: Semaphore,
  options: ConcurrencyWaitOptions,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw createCancellationErrorFromSignal(signal);
  if (!semaphore.isDisposed() && semaphore.getAvailablePermits() === 0) {
    assertQueueAvailable(semaphore.getWaitingCount(), options);
  }
  try {
    await semaphore.acquire({ signal, timeout: options.waitTimeoutMs });
  } catch (error) {
    if (semaphoreAcquireTimeoutError.is(error)) {
      throw middlewareConcurrencyWaitTimeoutError.new({
        waitTimeoutMs: options.waitTimeoutMs!,
      });
    }
    throw error;
  }
  try {
    if (signal?.aborted) throw createCancellationErrorFromSignal(signal);
    return await run();
  } finally {
    semaphore.release();
  }
}
