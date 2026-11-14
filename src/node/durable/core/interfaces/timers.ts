/**
 * Processes persisted timers for workflow sleeps, delayed retries, signal/child
 * wait timeouts, and scheduled workflow starts. Each setting applies to this
 * process; workers sharing a store coordinate through renewable timer claims.
 *
 * Queue consumption executes delivered workflows. Timer processing advances
 * deadlines. Recovery finds abandoned executions. Configure each independently.
 */
export interface DurableTimerConfig {
  /**
   * Automatically starts timer processing on this process. Default: true.
   *
   * Disable on API processes when workers sharing the same store handle timers.
   * Keep enabled on at least one process for sleeps, delayed retries, wait
   * timeouts, and schedules to advance. Disabling this does not disable queue
   * consumption, execution heartbeats, or orphan recovery.
   *
   * The store must implement `claimReadyTimers()` when enabled. An explicit
   * `DurableService.start()` call still starts processing after initialization.
   */
  enabled?: boolean;
  /**
   * Delay between checks for due timers, in milliseconds. Default: 1000.
   * Must be a positive integer. Lower values reduce idle wake-up latency and
   * increase store traffic; this is not an execution or external-call timeout.
   */
  pollIntervalMs?: number;
  /**
   * Maximum timer handlers running concurrently on this process. Default: 10.
   * Must be a positive integer. This limits timer processing, not workflow or
   * step concurrency. Cluster capacity grows with the number of timer workers.
   */
  concurrency?: number;
  /**
   * Duration of a worker's timer-processing claim, in milliseconds. Active
   * handlers renew their claims; after owner loss another worker can claim the
   * timer once this lease expires. Must be a positive integer.
   *
   * Default: 5000 with a queue, otherwise 30000. This is separate from the
   * execution ownership lease and does not set the workflow's deadline.
   */
  claimTtlMs?: number;
}
