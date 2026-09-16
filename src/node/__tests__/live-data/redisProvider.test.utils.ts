import { RedisLiveDataProvider } from "../../live-data/redisProvider";
import type { RedisLiveDataClient } from "../../live-data/redisProvider.types";

export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type RedisListener = (...args: any[]) => void;

export class RedisMock implements RedisLiveDataClient {
  status = "ready";
  readonly published: Array<{ channel: string; payload: string }> = [];
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  readonly subscribeResults: Promise<unknown>[] = [];
  readonly unsubscribeResults: Promise<unknown>[] = [];
  quitCalls = 0;
  quitFailure?: unknown;
  duplicateResult: RedisLiveDataClient = this;
  publishFailure?: unknown;
  private readonly listeners = new Map<string, Set<RedisListener>>();

  async publish(channel: string, payload: string): Promise<unknown> {
    if (this.publishFailure) throw this.publishFailure;
    this.published.push({ channel, payload });
    return 1;
  }

  async subscribe(channel: string): Promise<unknown> {
    this.subscribed.push(channel);
    return this.subscribeResults.shift();
  }

  async unsubscribe(channel: string): Promise<unknown> {
    this.unsubscribed.push(channel);
    return this.unsubscribeResults.shift();
  }

  duplicate(): RedisLiveDataClient {
    return this.duplicateResult;
  }

  async quit(): Promise<unknown> {
    this.quitCalls++;
    if (this.quitFailure) throw this.quitFailure;
    return "OK";
  }

  on(event: string, listener: RedisListener): unknown {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(listener);
    this.listeners.set(event, handlers);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

export function setupRedisProvider(subscriberStatus = "ready") {
  const publisher = new RedisMock();
  const subscriber = new RedisMock();
  subscriber.status = subscriberStatus;
  publisher.duplicateResult = subscriber;
  const provider = new RedisLiveDataProvider({
    redis: publisher,
    prefix: "test-live",
  });
  return { provider, publisher, subscriber };
}
