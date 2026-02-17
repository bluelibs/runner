import { EventManager } from "./EventManager";
import { defineEvent } from "../definers/defineEvent";
import { IEventDefinition, IEventEmission } from "../defs";
import {
  semaphoreInvalidPermitsError,
  semaphoreNonIntegerPermitsError,
  semaphoreDisposedError,
  semaphoreAcquireTimeoutError,
  cancellationError,
} from "../errors";

export type SemaphoreEventType =
  | "queued"
  | "acquired"
  | "released"
  | "timeout"
  | "aborted"
  | "disposed";

// Event definitions for Semaphore
const SemaphoreEvents = {
  queued: defineEvent<SemaphoreEvent>({ id: "semaphore.events.queued" }),
  acquired: defineEvent<SemaphoreEvent>({ id: "semaphore.events.acquired" }),
  released: defineEvent<SemaphoreEvent>({ id: "semaphore.events.released" }),
  timeout: defineEvent<SemaphoreEvent>({ id: "semaphore.events.timeout" }),
  aborted: defineEvent<SemaphoreEvent>({ id: "semaphore.events.aborted" }),
  disposed: defineEvent<SemaphoreEvent>({ id: "semaphore.events.disposed" }),
} as const satisfies Record<
  SemaphoreEventType,
  IEventDefinition<SemaphoreEvent>
>;

export type SemaphoreEvent = {
  type: SemaphoreEventType;
  permits: number;
  waiting: number;
  maxPermits: number;
  disposed: boolean;
};

interface WaitingOperation {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
  abortController?: AbortController;
  node?: WaitingNode;
  onPermit?: () => void;
}

interface WaitingNode {
  op: WaitingOperation;
  next: WaitingNode | null;
  prev: WaitingNode | null;
}

/**
 * A semaphore that limits the number of concurrent operations.
 * Used to prevent connection pool exhaustion by limiting concurrent
 * database operations to the pool size.
 */
export class Semaphore {
  private permits: number;
  private waitingHead: WaitingNode | null = null;
  private waitingTail: WaitingNode | null = null;
  private waitingCount = 0;
  private disposed = false;
  private readonly maxPermits: number;
  private readonly eventManager = new EventManager();
  private listenerId = 0;
  private activeListeners = new Set<number>();

  constructor(maxPermits: number) {
    if (maxPermits <= 0) {
      semaphoreInvalidPermitsError.throw({ maxPermits });
    }
    if (!Number.isInteger(maxPermits)) {
      semaphoreNonIntegerPermitsError.throw({ maxPermits });
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
      semaphoreDisposedError.throw();
    }

    if (options?.signal?.aborted) {
      cancellationError.throw({ reason: "Operation was aborted" });
    }

    if (this.permits > 0) {
      this.permits--;
      this.emit("acquired");
      return;
    }

    // No permits available, wait in queue
    return new Promise<void>((resolve, reject) => {
      const operation: WaitingOperation = {
        resolve,
        reject,
        onPermit: () => this.emit("acquired"),
      };

      // Set up timeout if provided
      if (options?.timeout && options.timeout > 0) {
        operation.timeout = setTimeout(() => {
          this.removeFromQueue(operation);
          this.emit("timeout");
          try {
            semaphoreAcquireTimeoutError.throw({ timeoutMs: options.timeout! });
          } catch (error: unknown) {
            operation.reject(error as Error);
          }
        }, options.timeout);
      }

      // Set up abort signal if provided
      if (options?.signal) {
        const abortHandler = () => {
          this.removeFromQueue(operation);
          this.emit("aborted");
          try {
            cancellationError.throw({ reason: "Operation was aborted" });
          } catch (error: unknown) {
            operation.reject(error as Error);
          }
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

      this.enqueue(operation);
      this.emit("queued");
    });
  }

  /**
   * Release a permit, allowing waiting operations to proceed.
   */
  release(): void {
    if (this.disposed) {
      return;
    }

    const nextOperation = this.dequeue();
    if (nextOperation) {
      // Give permit directly to next waiting operation

      // Clear timeout if it exists
      if (nextOperation.timeout) {
        clearTimeout(nextOperation.timeout);
      }

      nextOperation.onPermit?.();
      nextOperation.resolve();
    } else {
      // No one waiting, increment available permits (but don't exceed max)
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }

    this.emit("released");
  }

  private removeFromQueue(operation: WaitingOperation): void {
    const node = operation.node;
    if (!node) return;

    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.waitingHead = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.waitingTail = node.prev;
    }

    operation.node = undefined;
    this.waitingCount = Math.max(0, this.waitingCount - 1);

    // Clear timeout if it exists
    if (operation.timeout) {
      clearTimeout(operation.timeout);
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
    while (this.waitingHead) {
      const operation = this.dequeue()!;

      // Clear timeout if it exists
      if (operation.timeout) {
        clearTimeout(operation.timeout);
      }

      try {
        semaphoreDisposedError.throw();
      } catch (e: unknown) {
        operation.reject(e as Error);
      }
    }

    this.emit("disposed");
    this.eventManager.dispose();
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
    return this.waitingCount;
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
      waitingCount: this.waitingCount,
      maxPermits: this.maxPermits,
      utilization: (this.maxPermits - this.permits) / this.maxPermits,
      disposed: this.disposed,
    };
  }

  on(
    type: SemaphoreEventType,
    handler: (event: SemaphoreEvent) => any,
  ): () => void {
    const id = ++this.listenerId;
    this.activeListeners.add(id);
    const eventDef = SemaphoreEvents[type];

    this.eventManager.addListener(
      eventDef,
      (emission: IEventEmission<SemaphoreEvent>) => {
        if (this.activeListeners.has(id)) {
          handler(emission.data);
        }
      },
      {
        id: `semaphore-listener-${id}`,
        filter: () => this.activeListeners.has(id),
      },
    );

    return () => {
      this.activeListeners.delete(id);
    };
  }

  once(
    type: SemaphoreEventType,
    handler: (event: SemaphoreEvent) => any,
  ): () => void {
    const id = ++this.listenerId;
    this.activeListeners.add(id);
    const eventDef = SemaphoreEvents[type];

    this.eventManager.addListener(
      eventDef,
      (emission: IEventEmission<SemaphoreEvent>) => {
        if (this.activeListeners.has(id)) {
          this.activeListeners.delete(id);
          handler(emission.data);
        }
      },
      {
        id: `semaphore-listener-once-${id}`,
        filter: () => this.activeListeners.has(id),
      },
    );

    return () => {
      this.activeListeners.delete(id);
    };
  }

  private enqueue(operation: WaitingOperation): void {
    const node: WaitingNode = {
      op: operation,
      next: null,
      prev: this.waitingTail,
    };

    if (this.waitingTail) {
      this.waitingTail.next = node;
    } else {
      this.waitingHead = node;
    }

    this.waitingTail = node;
    operation.node = node;
    this.waitingCount++;
  }

  private dequeue(): WaitingOperation | null {
    const node = this.waitingHead;
    if (!node) return null;

    const next = node.next;
    if (next) {
      next.prev = null;
    } else {
      this.waitingTail = null;
    }

    this.waitingHead = next;
    node.next = null;
    node.prev = null;
    node.op.node = undefined;
    this.waitingCount = Math.max(0, this.waitingCount - 1);

    return node.op;
  }

  private emit(type: SemaphoreEventType): void {
    const eventDef = SemaphoreEvents[type];
    // Fire-and-forget to maintain synchronous behavior, but always catch to avoid
    // process-level unhandledRejection if a lifecycle listener throws.
    void this.eventManager
      .emit(eventDef, this.buildEvent(type), "semaphore")
      .catch(() => {});
  }

  private buildEvent(type: SemaphoreEventType): SemaphoreEvent {
    return {
      type,
      permits: this.permits,
      waiting: this.waitingCount,
      maxPermits: this.maxPermits,
      disposed: this.disposed,
    };
  }
}
