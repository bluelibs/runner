import type { SerializerLike } from "../../serializer";
import type { LiveSubscription, LiveSubscriptionEvent } from "./types";

type Pending<T> = {
  resolve(value: IteratorResult<LiveSubscriptionEvent<T>>): void;
  reject(error: unknown): void;
};

export class LiveSubscriptionQueue<T> implements LiveSubscription<T> {
  private readonly buffered: LiveSubscriptionEvent<T>[] = [];
  private readonly pending: Pending<T>[] = [];
  private closed = false;
  private failure: unknown;
  private abortListener?: () => void;
  private readonly signal?: AbortSignal;
  private closePromise?: Promise<void>;

  constructor(
    private readonly serializer: SerializerLike,
    private readonly onClose: () => Promise<void>,
    signal?: AbortSignal,
  ) {
    this.signal = signal;
    if (signal) {
      this.abortListener = () => void this.close().catch(() => undefined);
      if (signal.aborted) this.closed = true;
      else signal.addEventListener("abort", this.abortListener, { once: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<LiveSubscriptionEvent<T>> {
    return this;
  }

  async next(): Promise<IteratorResult<LiveSubscriptionEvent<T>>> {
    if (this.buffered.length > 0) {
      return { done: false, value: this.buffered.shift()! };
    }
    if (this.failure !== undefined) throw this.failure;
    if (this.closed) return { done: true, value: undefined };

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  async return(): Promise<IteratorResult<LiveSubscriptionEvent<T>>> {
    await this.close();
    return { done: true, value: undefined };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.buffered.length = 0;
    this.removeAbortListener();
    this.closePromise = (async () => {
      try {
        await this.onClose();
      } finally {
        this.finishPending();
      }
    })();
    return this.closePromise;
  }

  pushSnapshot(revision: number, serializedData: string): void {
    this.push({
      type: "snapshot",
      revision,
      data: this.serializer.parse<T>(serializedData),
    });
  }

  pushStale(): void {
    for (let index = this.buffered.length - 1; index >= 0; index--) {
      if (this.buffered[index]?.type === "snapshot") {
        this.buffered.splice(index, 1);
      }
    }
    this.push({ type: "stale", reason: "bus-disconnected" });
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.failure = error;
    this.closed = true;
    this.buffered.length = 0;
    this.removeAbortListener();
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }

  finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffered.length = 0;
    this.removeAbortListener();
    this.finishPending();
  }

  private push(event: LiveSubscriptionEvent<T>): void {
    if (this.closed) return;
    const pending = this.pending.shift();
    if (pending) pending.resolve({ done: false, value: event });
    else {
      if (event.type === "snapshot") {
        const snapshotIndex = this.buffered.findIndex(
          (buffered) => buffered.type === "snapshot",
        );
        if (snapshotIndex !== -1) this.buffered.splice(snapshotIndex, 1);
      } else if (this.buffered.some((buffered) => buffered.type === "stale")) {
        return;
      }
      this.buffered.push(event);
    }
  }

  private finishPending(): void {
    for (const pending of this.pending.splice(0)) {
      pending.resolve({ done: true, value: undefined });
    }
  }

  private removeAbortListener(): void {
    if (!this.abortListener) return;
    this.signal?.removeEventListener("abort", this.abortListener);
    this.abortListener = undefined;
  }
}
