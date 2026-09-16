import type { SerializerLike } from "../../serializer";
import type { ITimerHandle, ITimers } from "../../types/timers";
import type { LiveQuery, LiveDataProviderEvent } from "./types";
import type { LiveSubscriptionQueue } from "./subscription";
import { validationError } from "../../errors";
import { serializeLiveValue } from "./serialization";

export interface ObserverConfig {
  query: LiveQuery;
  topicKeys: readonly string[];
  providerSubscribe(
    topicKeys: readonly string[],
    listener: (event: LiveDataProviderEvent) => void,
  ): Promise<() => Promise<void>>;
  isConnected(): boolean;
  run(signal: AbortSignal): Promise<unknown>;
  serializer: SerializerLike;
  timers: ITimers;
  onEmpty(): void;
}

export class LiveObserver {
  private readonly subscribers = new Set<LiveSubscriptionQueue<unknown>>();
  private unsubscribe?: () => Promise<void>;
  private interval?: ITimerHandle;
  private batchTimer?: ITimerHandle;
  private generation = 0;
  private revision = 0;
  private currentPayload?: string;
  private refreshPromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private activeRead?: AbortController;
  private refreshAfterCurrent = false;
  private closePromise?: Promise<void>;
  private initialized = false;
  private stale = false;
  private closed = false;

  constructor(private readonly config: ObserverConfig) {}

  ensureStarted(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.start();
    return this.startPromise;
  }

  private async start(): Promise<void> {
    const unsubscribe = await this.config.providerSubscribe(
      this.config.topicKeys,
      (event) => this.onProviderEvent(event),
    );
    this.unsubscribe = unsubscribe;
    if (this.closed) {
      return validationError.throw({
        subject: "Live data subscription",
        id: this.config.query.task.id,
        originalError: "The subscription closed before its initial snapshot.",
      });
    }
    if (!this.config.isConnected()) {
      return validationError.throw({
        subject: "Live data subscription",
        id: this.config.query.task.id,
        originalError: "The provider disconnected before the initial snapshot.",
      });
    }

    await this.refresh();
    if (!this.initialized) {
      return validationError.throw({
        subject: "Live data subscription",
        id: this.config.query.task.id,
        originalError:
          "The provider disconnected before the initial snapshot completed.",
      });
    }
    if (!this.closed && this.config.query.revalidateEveryMs !== undefined) {
      this.interval = this.config.timers.setInterval(
        () => this.requestRefresh(),
        this.config.query.revalidateEveryMs,
      );
    }
  }

  add(subscriber: LiveSubscriptionQueue<unknown>): void {
    this.subscribers.add(subscriber);
    if (this.stale) subscriber.pushStale();
    if (this.currentPayload !== undefined) {
      subscriber.pushSnapshot(this.revision, this.currentPayload);
    }
  }

  async remove(subscriber: LiveSubscriptionQueue<unknown>): Promise<void> {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size === 0) {
      this.config.onEmpty();
      await this.close();
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.activeRead?.abort("Live subscription closed.");
    this.batchTimer?.cancel();
    this.interval?.cancel();
    this.closePromise = (async () => {
      try {
        await this.startPromise?.catch(() => undefined);
        await this.unsubscribe?.();
      } finally {
        for (const subscriber of this.subscribers) subscriber.finish();
        this.subscribers.clear();
      }
    })();
    return this.closePromise;
  }

  private onProviderEvent(event: LiveDataProviderEvent): void {
    if (this.closed) return;
    if (event.type === "disconnect") {
      this.activeRead?.abort("Live-data provider disconnected.");
      this.markStale();
      return;
    }
    if (event.type === "resync") {
      this.stale = false;
      this.generation++;
      this.currentPayload = undefined;
      if (this.refreshPromise) this.refreshAfterCurrent = true;
      this.requestRefresh();
      return;
    }

    this.generation++;
    this.requestRefresh();
  }

  private markStale(): void {
    if (this.stale) return;
    this.stale = true;
    for (const subscriber of this.subscribers) subscriber.pushStale();
  }

  private requestRefresh(): void {
    if (this.closed || this.stale || !this.config.isConnected()) return;
    if (this.refreshPromise) return;
    if (this.config.query.batchWindowMs === 0) {
      void this.refreshSafely().catch(() => undefined);
      return;
    }
    if (this.batchTimer) return;
    this.batchTimer = this.config.timers.setTimeout(() => {
      this.batchTimer = undefined;
      return this.refreshSafely();
    }, this.config.query.batchWindowMs);
  }

  private async refreshSafely(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      if (this.closed || this.stale) return;
      for (const subscriber of this.subscribers) subscriber.fail(error);
      this.config.onEmpty();
      await this.close().catch(() => undefined);
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.readUntilCurrent().finally(() => {
      this.refreshPromise = null;
      if (this.refreshAfterCurrent) {
        this.refreshAfterCurrent = false;
        this.requestRefresh();
      }
    });
    return this.refreshPromise;
  }

  private async readUntilCurrent(): Promise<void> {
    while (!this.closed && !this.stale && this.config.isConnected()) {
      const readGeneration = this.generation;
      const controller = new AbortController();
      this.activeRead = controller;
      let result: unknown;
      try {
        result = await this.config.run(controller.signal);
      } catch (error) {
        if (controller.signal.aborted && !this.closed) {
          if (this.stale || !this.config.isConnected()) return;
          continue;
        }
        throw error;
      } finally {
        this.activeRead = undefined;
      }
      if (this.closed || this.stale || !this.config.isConnected()) return;
      const payload = serializeLiveValue(result, this.config.serializer);
      if (readGeneration !== this.generation) continue;

      if (!this.initialized || payload !== this.currentPayload) {
        this.initialized = true;
        this.currentPayload = payload;
        this.revision++;
        for (const subscriber of this.subscribers) {
          subscriber.pushSnapshot(this.revision, payload);
        }
      }
      this.refreshAfterCurrent = false;
      return;
    }
  }
}
