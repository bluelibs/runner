import { frameworkError } from "../../../definers/builders/error";

/** A concurrency pool cannot retain another local waiter. */
export const middlewareConcurrencyQueueFullError = frameworkError<{
  maxQueue: number;
}>("middleware-concurrencyQueueFull")
  .format(
    ({ maxQueue }) => `Concurrency queue is full (maxQueue: ${maxQueue}).`,
  )
  .httpCode(503)
  .build();

/** A call could not acquire a permit within its admission deadline. */
export const middlewareConcurrencyWaitTimeoutError = frameworkError<{
  waitTimeoutMs: number;
}>("middleware-concurrencyWaitTimeout")
  .format(
    ({ waitTimeoutMs }) =>
      `Concurrency permit acquisition timed out after ${waitTimeoutMs}ms.`,
  )
  .httpCode(503)
  .build();
