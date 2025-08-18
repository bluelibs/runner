interface WaitingOperation {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
  abortController?: AbortController;
}

/**
 * A semaphore that limits the number of concurrent operations.
 * Used to prevent connection pool exhaustion by limiting concurrent
 * database operations to the pool size.
 */
export class Semaphore {
  private permits: number;
  private readonly waitingQueue: Array<WaitingOperation> = [];
  private disposed = false;
  private readonly maxPermits: number;

  constructor(maxPermits: number) {
    if (maxPermits <= 0) {
      throw new Error("maxPermits must be greater than 0");
    }
    this.permits = maxPermits;
    this.maxPermits = maxPermits;
  }

  /**
   * Acquire a permit. If no permits are available, waits until one becomes available.
   */
  async acquire(options?: {
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    if (this.disposed) {
      throw new Error("Semaphore has been disposed");
    }

    if (options?.signal?.aborted) {
      throw new Error("Operation was aborted");
    }

    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // No permits available, wait in queue
    return new Promise<void>((resolve, reject) => {
      const operation: WaitingOperation = { resolve, reject };

      // Set up timeout if provided
      if (options?.timeout && options.timeout > 0) {
        operation.timeout = setTimeout(() => {
          this.removeFromQueue(operation);
          reject(
            new Error(`Semaphore acquire timeout after ${options.timeout}ms`),
          );
        }, options.timeout);
      }

      // Set up abort signal if provided
      if (options?.signal) {
        const abortHandler = () => {
          this.removeFromQueue(operation);
          reject(new Error("Operation was aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });

        // Clean up the abort listener when operation completes
        const originalResolve = operation.resolve;
        const originalReject = operation.reject;

        operation.resolve = () => {
          options.signal!.removeEventListener("abort", abortHandler);
          originalResolve();
        };

        operation.reject = (error: Error) => {
          options.signal!.removeEventListener("abort", abortHandler);
          originalReject(error);
        };
      }

      this.waitingQueue.push(operation);
    });
  }

  /**
   * Release a permit, allowing waiting operations to proceed.
   */
  release(): void {
    if (this.disposed) {
      return;
    }

    if (this.waitingQueue.length > 0) {
      // Give permit directly to next waiting operation
      const nextOperation = this.waitingQueue.shift()!;

      // Clear timeout if it exists
      if (nextOperation.timeout) {
        clearTimeout(nextOperation.timeout);
      }

      nextOperation.resolve();
    } else {
      // No one waiting, increment available permits (but don't exceed max)
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  private removeFromQueue(operation: WaitingOperation): void {
    const index = this.waitingQueue.indexOf(operation);
    if (index !== -1) {
      this.waitingQueue.splice(index, 1);

      // Clear timeout if it exists
      if (operation.timeout) {
        clearTimeout(operation.timeout);
      }
    }
  }

  /**
   * Execute a function with a permit, automatically releasing it afterwards.
   */
  async withPermit<T>(
    fn: () => Promise<T>,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<T> {
    await this.acquire(options);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Dispose the semaphore, rejecting all waiting operations and preventing new ones.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Reject all waiting operations
    while (this.waitingQueue.length > 0) {
      const operation = this.waitingQueue.shift()!;

      // Clear timeout if it exists
      if (operation.timeout) {
        clearTimeout(operation.timeout);
      }

      operation.reject(new Error("Semaphore has been disposed"));
    }
  }

  /**
   * Get current number of available permits (for debugging)
   */
  getAvailablePermits(): number {
    return this.permits;
  }

  /**
   * Get current number of waiting operations (for debugging)
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }

  /**
   * Get maximum number of permits
   */
  getMaxPermits(): number {
    return this.maxPermits;
  }

  /**
   * Check if the semaphore has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Get metrics about the current state of the semaphore
   */
  getMetrics(): {
    availablePermits: number;
    waitingCount: number;
    maxPermits: number;
    utilization: number;
    disposed: boolean;
  } {
    return {
      availablePermits: this.permits,
      waitingCount: this.waitingQueue.length,
      maxPermits: this.maxPermits,
      utilization: (this.maxPermits - this.permits) / this.maxPermits,
      disposed: this.disposed,
    };
  }
}
