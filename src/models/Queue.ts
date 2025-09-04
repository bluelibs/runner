import { getPlatform } from "../platform";

/**
 * Cooperative task queue.
 *  • Tasks run one‑after‑another (FIFO ordering).
 *  • Dead‑lock detection prevents nesting.
 *  • dispose() drains or cancels outstanding tasks, then rejects new ones.
 */
export class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private abortController = new AbortController();

  // true while inside a queued task → helps detect "queue in queue"
  private readonly executionContext =
    getPlatform().createAsyncLocalStorage<boolean>();

  /**
   * Schedule an asynchronous task.
   * @param task – receives an AbortSignal so it can cancel early if desired.
   */
  public run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // 1. refuse new work if we've disposed
    if (this.disposed) {
      return Promise.reject(new Error("Queue has been disposed"));
    }

    // 2. detect dead‑locks (a queued task adding another queued task)
    if (this.executionContext.getStore()) {
      return Promise.reject(
        new Error(
          "Dead‑lock detected: a queued task attempted to queue another task",
        ),
      );
    }

    const { signal } = this.abortController;

    // 3. chain task after the current tail
    const result = this.tail.then(() =>
      this.executionContext.run(true, () => task(signal)),
    );

    // 4. preserve the chain even if the task rejects (swallow internally)
    this.tail = result.catch(() => {});

    return result;
  }

  /**
   * Disposes the queue.
   * @param options.cancel – if true, broadcasts AbortSignal to running task.
   *                         default: false (waits for tasks to finish).
   */
  public async dispose(options: { cancel?: boolean } = {}): Promise<void> {
    if (this.disposed) return;

    this.disposed = true;

    if (options.cancel) {
      this.abortController.abort(); // notify cooperative tasks
    }

    // wait for everything already chained to settle
    await this.tail.catch(() => {});
  }
}
