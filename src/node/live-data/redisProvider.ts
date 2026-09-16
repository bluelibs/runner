import { randomUUID } from "node:crypto";
import {
  closeRedisClients,
  resolveRedisPublisher,
} from "./redisProvider.client";
import {
  invalidRedis,
  isRedisLiveDataClient,
  MAX_REDIS_MESSAGE_BYTES,
  normalizeRedisTopicKeys,
  parseRedisEnvelope,
  redisLiveDataChannel,
  redisSetsIntersect,
} from "./redisProvider.protocol";
import type {
  RedisLiveDataClient,
  RedisLiveDataProviderOptions,
} from "./redisProvider.types";
import type { LiveDataProvider, LiveDataProviderEvent } from "./types";

const MAX_SEEN_MESSAGES = 1024;

type Registration = {
  topics: ReadonlySet<string>;
  listener: (event: LiveDataProviderEvent) => void;
};

type ChannelState = {
  refs: number;
  subscribedGeneration: number | null;
  operation: Promise<void>;
};

export type {
  RedisLiveDataClient,
  RedisLiveDataProviderOptions,
} from "./redisProvider.types";

/** Redis Pub/Sub invalidation provider with per-topic channels and reconnect resync. */
export class RedisLiveDataProvider implements LiveDataProvider {
  private readonly publisher: RedisLiveDataClient;
  private readonly subscriber: RedisLiveDataClient;
  private readonly ownsPublisher: boolean;
  private readonly prefix: string;
  private readonly registrations = new Set<Registration>();
  private readonly channels = new Map<string, ChannelState>();
  private readonly seenIds = new Set<string>();
  private reconnecting: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private readyGeneration: number | null = null;
  private connectionGeneration = 0;
  private isDisposed = false;
  private isConnected = true;

  /** Creates a provider and a dedicated duplicate connection for subscriptions. */
  constructor(options: RedisLiveDataProviderOptions = {}) {
    this.ownsPublisher =
      typeof options.redis === "string" || options.redis === undefined;
    const publisher = resolveRedisPublisher(options.redis);
    if (!isRedisLiveDataClient(publisher)) {
      invalidRedis(
        "requires a compatible client with publish(), duplicate(), and quit().",
      );
    }
    this.publisher = publisher;

    const subscriber = publisher.duplicate();
    if (!isRedisLiveDataClient(subscriber)) {
      invalidRedis("duplicate() must return a compatible Redis client.");
    }
    this.subscriber = subscriber;

    this.prefix = options.prefix ?? `runner:live-data:${randomUUID()}`;
    this.isConnected = subscriber.status !== "end";
    subscriber.on("message", (channel, payload) => {
      this.onMessage(channel, payload);
    });
    subscriber.on("close", () => this.onDisconnect());
    subscriber.on("end", () => this.onDisconnect());
    subscriber.on("ready", () => this.onReady());
  }

  /** Whether Redis currently provides fresh invalidation guarantees. */
  get connected(): boolean {
    return this.isConnected;
  }

  /** Publishes one deduplicated invalidation envelope to every topic channel. */
  async publish(topicKeys: readonly string[]): Promise<void> {
    this.assertActive();
    const topics = normalizeRedisTopicKeys(topicKeys);
    const payload = JSON.stringify({ v: 1, id: randomUUID(), topics });
    if (Buffer.byteLength(payload) > MAX_REDIS_MESSAGE_BYTES) {
      invalidRedis(
        `invalidation messages cannot exceed ${MAX_REDIS_MESSAGE_BYTES} bytes.`,
      );
    }

    await Promise.all(
      topics.map((topic) =>
        this.publisher.publish(this.channel(topic), payload),
      ),
    );
  }

  /** Resolves after every channel subscription is acknowledged by Redis. */
  async subscribe(
    topicKeys: readonly string[],
    listener: (event: LiveDataProviderEvent) => void,
  ): Promise<() => Promise<void>> {
    this.assertActive();
    const topics = new Set(normalizeRedisTopicKeys(topicKeys));
    const registration = { topics, listener };

    try {
      await Promise.all([...topics].map((topic) => this.acquireChannel(topic)));
      this.assertActive();
      this.registrations.add(registration);
    } catch (error) {
      await Promise.all([...topics].map((topic) => this.releaseChannel(topic)));
      throw error;
    }

    return async () => {
      if (!this.registrations.delete(registration)) return;
      await Promise.all([...topics].map((topic) => this.releaseChannel(topic)));
    };
  }

  /** Closes the subscriber and any publisher created by this provider. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.isDisposed = true;
    this.registrations.clear();
    this.channels.clear();
    this.disposal = closeRedisClients(
      this.subscriber,
      this.ownsPublisher ? this.publisher : undefined,
    );
    return this.disposal;
  }
  private assertActive(): void {
    if (this.isDisposed) invalidRedis("is already disposed.");
  }
  private onMessage(channel: string, payload: string): void {
    if (
      !this.channels.has(channel) ||
      Buffer.byteLength(payload) > MAX_REDIS_MESSAGE_BYTES
    ) {
      return;
    }
    const envelope = parseRedisEnvelope(payload);
    if (!envelope || this.seenIds.has(envelope.id)) return;
    this.remember(envelope.id);

    const published = new Set(envelope.topics);
    for (const registration of this.registrations) {
      if (!redisSetsIntersect(registration.topics, published)) continue;
      registration.listener({ type: "invalidate", topics: envelope.topics });
    }
  }
  private onDisconnect(): void {
    if (this.isDisposed) return;
    const shouldNotify = this.isConnected;
    this.isConnected = false;
    this.connectionGeneration++;
    for (const state of this.channels.values()) {
      state.subscribedGeneration = null;
    }
    if (shouldNotify) this.notify({ type: "disconnect" });
  }
  private onReady(): void {
    if (this.isDisposed) return;
    this.readyGeneration = this.connectionGeneration;
    if (this.reconnecting) return;

    const reconnecting = this.resyncReadyGenerations();
    this.reconnecting = reconnecting;
    void reconnecting.then(
      () => {
        this.reconnecting = null;
      },
      () => {
        this.reconnecting = null;
        this.onDisconnect();
      },
    );
  }

  private async resyncReadyGenerations(): Promise<void> {
    while (!this.isDisposed && this.readyGeneration !== null) {
      const generation = this.readyGeneration;
      this.readyGeneration = null;
      await Promise.all(
        [...this.channels.entries()].map(([channel, state]) =>
          this.ensureChannelSubscribed(channel, state, generation),
        ),
      ).catch((error: unknown) => {
        if (this.isDisposed) return;
        if (generation !== this.connectionGeneration) return;
        this.readyGeneration = null;
        throw error;
      });
      if (this.isDisposed || generation !== this.connectionGeneration) continue;
      if (this.readyGeneration === generation) this.readyGeneration = null;
      this.isConnected = true;
      this.notify({ type: "resync" });
    }
  }

  private notify(event: LiveDataProviderEvent): void {
    const listeners = new Set(
      [...this.registrations].map((registration) => registration.listener),
    );
    for (const listener of listeners) listener(event);
  }

  private async acquireChannel(topic: string): Promise<void> {
    const channel = this.channel(topic);
    let state = this.channels.get(channel);
    if (!state) {
      state = {
        refs: 0,
        subscribedGeneration: null,
        operation: Promise.resolve(),
      };
      this.channels.set(channel, state);
    }
    state.refs++;
    await this.ensureChannelSubscribed(
      channel,
      state,
      this.connectionGeneration,
    );
  }

  private ensureChannelSubscribed(
    channel: string,
    state: ChannelState,
    generation: number,
  ): Promise<void> {
    state.operation = state.operation
      .catch(() => undefined)
      .then(async () => {
        if (
          state.refs === 0 ||
          state.subscribedGeneration === generation ||
          generation !== this.connectionGeneration ||
          this.isDisposed
        ) {
          return;
        }
        await this.subscriber.subscribe(channel);
        if (
          !this.isDisposed &&
          generation === this.connectionGeneration &&
          state.refs > 0 &&
          this.channels.get(channel) === state
        ) {
          state.subscribedGeneration = generation;
        }
      });
    return state.operation;
  }

  private async releaseChannel(topic: string): Promise<void> {
    const channel = this.channel(topic);
    const state = this.channels.get(channel);
    if (!state) return;
    state.refs = Math.max(0, state.refs - 1);
    state.operation = state.operation
      .catch(() => undefined)
      .then(async () => {
        if (state.refs !== 0) return;
        const shouldUnsubscribe =
          state.subscribedGeneration !== null && !this.isDisposed;
        state.subscribedGeneration = null;
        try {
          if (shouldUnsubscribe) await this.subscriber.unsubscribe(channel);
        } finally {
          if (state.refs === 0 && this.channels.get(channel) === state) {
            this.channels.delete(channel);
          }
        }
      });
    await state.operation;
  }

  private channel(topic: string): string {
    return redisLiveDataChannel(this.prefix, topic);
  }

  private remember(id: string): void {
    this.seenIds.add(id);
    if (this.seenIds.size <= MAX_SEEN_MESSAGES) return;
    this.seenIds.delete(this.seenIds.values().next().value!);
  }
}
