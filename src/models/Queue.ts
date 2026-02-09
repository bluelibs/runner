import { getPlatform } from "../platform";
import { EventManager } from "./EventManager";
import { defineEvent } from "../definers/defineEvent";
import { IEventDefinition, IEventEmission } from "../defs";

export type QueueEventType =
  | "enqueue"
  | "start"
  | "finish"
  | "error"
  | "cancel"
  | "disposed";

// Event definitions for Queue
const QueueEvents = {
  enqueue: defineEvent<QueueEvent>({ id: "queue.events.enqueue" }),
  start: defineEvent<QueueEvent>({ id: "queue.events.start" }),
  finish: defineEvent<QueueEvent>({ id: "queue.events.finish" }),
  error: defineEvent<QueueEvent>({ id: "queue.events.error" }),
  cancel: defineEvent<QueueEvent>({ id: "queue.events.cancel" }),
  disposed: defineEvent<QueueEvent>({ id: "queue.events.disposed" }),
} as const satisfies Record<QueueEventType, IEventDefinition<QueueEvent>>;

export type QueueEvent = {
  type: QueueEventType;
  taskId: number;
  disposed: boolean;
  error?: Error;
};

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
  private readonly eventManager = new EventManager();
  private nextTaskId = 1;
  private listenerId = 0;
  private activeListeners = new Set<number>();

  // true while inside a queued task → helps detect "queue in queue"
  private readonly executionContext =
    getPlatform().createAsyncLocalStorage<boolean>();

  private readonly hasAsyncLocalStorage = getPlatform().hasAsyncLocalStorage();

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
    if (this.hasAsyncLocalStorage && this.executionContext.getStore()) {
      return Promise.reject(
        new Error(
          "Dead‑lock detected: a queued task attempted to queue another task",
        ),
      );
    }

    const { signal } = this.abortController;
    const taskId = this.nextTaskId++;
    this.emit("enqueue", taskId);

    // 3. chain task after the current tail
    const result = this.tail.then(() => {
      this.emit("start", taskId);
      return this.hasAsyncLocalStorage
        ? this.executionContext.run(true, () => task(signal))
        : task(signal);
    });

    // 4. preserve the chain even if the task rejects (swallow internally)
    this.tail = result
      .then((value) => {
        this.emit("finish", taskId);
        return value;
      })
      .catch((error) => {
        this.emit("error", taskId, error as Error);
      });

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
    this.emit("disposed", 0);

    if (options.cancel) {
      this.abortController.abort(); // notify cooperative tasks
      this.emit("cancel", 0);
    }

    // wait for everything already chained to settle
    await this.tail.catch(() => {});

    this.eventManager.dispose();
  }

  on(type: QueueEventType, handler: (event: QueueEvent) => any): () => void {
    const id = ++this.listenerId;
    this.activeListeners.add(id);
    const eventDef = QueueEvents[type];

    this.eventManager.addListener(
      eventDef,
      (emission: IEventEmission<QueueEvent>) => {
        if (this.activeListeners.has(id)) {
          handler(emission.data);
        }
      },
      {
        id: `queue-listener-${id}`,
        filter: () => this.activeListeners.has(id),
      },
    );

    return () => {
      this.activeListeners.delete(id);
    };
  }

  once(type: QueueEventType, handler: (event: QueueEvent) => any): () => void {
    const id = ++this.listenerId;
    this.activeListeners.add(id);
    const eventDef = QueueEvents[type];

    this.eventManager.addListener(
      eventDef,
      (emission: IEventEmission<QueueEvent>) => {
        if (this.activeListeners.has(id)) {
          this.activeListeners.delete(id);
          handler(emission.data);
        }
      },
      {
        id: `queue-listener-once-${id}`,
        filter: () => this.activeListeners.has(id),
      },
    );

    return () => {
      this.activeListeners.delete(id);
    };
  }

  private emit(type: QueueEventType, taskId: number, error?: Error): void {
    const eventDef = QueueEvents[type];
    // Fire-and-forget to maintain synchronous behavior, but always catch to avoid
    // process-level unhandledRejection if a lifecycle listener throws.
    void this.eventManager
      .emit(
        eventDef,
        {
          type,
          taskId,
          disposed: this.disposed,
          error,
        },
        "queue",
      )
      .catch(() => {});
  }
}
