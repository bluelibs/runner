/** Minimal Redis client contract used by the live-data provider. */
export interface RedisLiveDataClient {
  /** Current transport status when exposed by the client. */
  readonly status?: string;
  /** Publishes one serialized invalidation to a Redis channel. */
  publish(channel: string, payload: string): Promise<unknown>;
  /** Subscribes the connection to a Redis channel. */
  subscribe(channel: string): Promise<unknown>;
  /** Unsubscribes the connection from a Redis channel. */
  unsubscribe(channel: string): Promise<unknown>;
  /** Creates the dedicated connection used for subscriptions. */
  duplicate(): RedisLiveDataClient;
  /** Gracefully closes this Redis connection. */
  quit(): Promise<unknown>;
  /** Registers a Redis Pub/Sub message listener. */
  on(
    event: "message",
    listener: (channel: string, payload: string) => void,
  ): unknown;
  /** Registers a Redis connection lifecycle listener. */
  on(event: "close" | "end" | "ready", listener: () => void): unknown;
}

/** Options for a Redis-backed live-data invalidation provider. */
export interface RedisLiveDataProviderOptions {
  /** Redis URL for an owned client, or a borrowed compatible publisher client. */
  redis?: string | RedisLiveDataClient;
  /** Stable channel prefix shared by every participating process. */
  prefix?: string;
}
