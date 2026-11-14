/** Runtime-only authority for writes made by one execution attempt. */
export interface DurableExecutionOwnership {
  /** Exact execution storage identity whose lease authorizes the attempt. */
  executionId: string;
  /** Opaque token returned by acquireLock(`execution:${executionId}`, ...). */
  lockId: string;
  /** Invalidates the live attempt and throws when its lease no longer owns a write. */
  onLost(): never;
}
