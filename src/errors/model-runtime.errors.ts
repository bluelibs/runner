import { error } from "../definers/builders/error";
import type { DefaultErrorType } from "../types/error";

// Store: TaskRunner not set
export const taskRunnerNotSetError = error<DefaultErrorType>(
  "runner.errors.store.taskRunnerNotSet",
)
  .format(
    () =>
      "TaskRunner is not set. Call store.setTaskRunner() before initializeStore().",
  )
  .remediation(
    "Ensure setTaskRunner() is called on the Store instance before calling initializeStore(). This is typically done by the runtime setup.",
  )
  .build();

// Queue: Queue disposed
export const queueDisposedError = error<DefaultErrorType>(
  "runner.errors.queue.disposed",
)
  .format(() => "Queue has been disposed")
  .remediation(
    "The queue has already been disposed. Create a new Queue instance to continue enqueueing tasks.",
  )
  .build();

// Queue: Deadlock detected
export const queueDeadlockError = error<DefaultErrorType>(
  "runner.errors.queue.deadlock",
)
  .format(
    () => "Dead‑lock detected: a queued task attempted to queue another task",
  )
  .remediation(
    "Avoid calling queue.run() from within another queued task. If you need to chain tasks, consider using task dependencies or hooks instead.",
  )
  .build();

// Semaphore: Invalid permits (must be > 0)
export const semaphoreInvalidPermitsError = error<
  { maxPermits: number } & DefaultErrorType
>("runner.errors.semaphore.invalidPermits")
  .format(
    ({ maxPermits }) =>
      `maxPermits must be greater than 0. Received: ${maxPermits}`,
  )
  .remediation(
    "Pass a positive integer greater than 0 to the Semaphore constructor. For example: new Semaphore(5)",
  )
  .build();

// Semaphore: Non-integer permits
export const semaphoreNonIntegerPermitsError = error<
  { maxPermits: number } & DefaultErrorType
>("runner.errors.semaphore.nonIntegerPermits")
  .format(
    ({ maxPermits }) =>
      `maxPermits must be an integer. Received: ${maxPermits}`,
  )
  .remediation(
    "Pass an integer value to the Semaphore constructor. For example: new Semaphore(5) not new Semaphore(5.5)",
  )
  .build();

// Semaphore: Disposed
export const semaphoreDisposedError = error<DefaultErrorType>(
  "runner.errors.semaphore.disposed",
)
  .format(() => "Semaphore has been disposed")
  .remediation(
    "The semaphore has been disposed and cannot be used for new operations. Create a new Semaphore instance if you need to acquire permits.",
  )
  .build();

// Semaphore: Acquire timeout
export const semaphoreAcquireTimeoutError = error<
  { timeoutMs: number } & DefaultErrorType
>("runner.errors.semaphore.acquireTimeout")
  .format(({ timeoutMs }) => `Semaphore acquire timeout after ${timeoutMs}ms`)
  .remediation(
    ({ timeoutMs }) =>
      `Increase the timeout (currently ${timeoutMs}ms), reduce semaphore contention, or raise maxPermits if your workload requires more concurrency.`,
  )
  .build();

// ExecutionJournal: Duplicate key
export const journalDuplicateKeyError = error<
  { keyId: string } & DefaultErrorType
>("runner.errors.journal.duplicateKey")
  .format(
    ({ keyId }) =>
      `Journal key "${keyId}" already exists. Use { override: true } to overwrite.`,
  )
  .remediation(
    ({ keyId }) =>
      `Either use { override: true } when calling journal.set() for key "${keyId}", or use a different key name to avoid conflicts.`,
  )
  .build();

// MiddlewareManager: Unknown middleware type
export const unknownMiddlewareTypeError = error<DefaultErrorType>(
  "runner.errors.middleware.unknownType",
)
  .format(() => "Unknown middleware type")
  .remediation(
    "Ensure you are passing a valid task or resource middleware to interceptMiddleware(). Check that the middleware was created using r.taskMiddleware() or r.resourceMiddleware().",
  )
  .build();

// DependencyProcessor: Parallel initialization scheduling failure
export const parallelInitSchedulingError = error<DefaultErrorType>(
  "runner.errors.dependencyProcessor.parallelInitScheduling",
)
  .format(
    () =>
      "Could not schedule pending resources for initialization in parallel mode.",
  )
  .remediation(
    "This indicates a dependency ordering issue in parallel initialization mode. Ensure all resources have their dependencies properly declared, or switch to sequential initialization mode via run(app, { initMode: 'sequential' }).",
  )
  .build();
