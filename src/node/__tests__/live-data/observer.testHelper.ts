import { r } from "../../../index";
import { Serializer } from "../../../serializer";
import { LiveObserver } from "../../live-data/observer";
import { query } from "../../live-data/query";
import { LiveSubscriptionQueue } from "../../live-data/subscription";
import { topic } from "../../live-data/topic";
import type { ITimers } from "../../../types/timers";
import type { LiveDataProviderEvent } from "../../live-data/types";

type TimerCallback = () => void | Promise<void>;

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function createObserverHarness(options?: {
  batchWindowMs?: number;
  connected?: boolean;
  revalidateEveryMs?: number;
  run?: (signal: AbortSignal) => Promise<unknown>;
  subscribe?: (
    listener: (event: LiveDataProviderEvent) => void,
  ) => Promise<() => Promise<void>>;
  onEmpty?: () => void;
}) {
  let connected = options?.connected ?? true;
  let listener: (event: LiveDataProviderEvent) => void = () => undefined;
  const timeouts: TimerCallback[] = [];
  const intervals: TimerCallback[] = [];
  const timeoutCancels: jest.Mock[] = [];
  const intervalCancels: jest.Mock[] = [];
  const timers: ITimers = {
    setTimeout(callback) {
      timeouts.push(callback);
      const cancel = jest.fn();
      timeoutCancels.push(cancel);
      return { cancel };
    },
    setInterval(callback) {
      intervals.push(callback);
      const cancel = jest.fn();
      intervalCancels.push(cancel);
      return { cancel };
    },
  };
  const task = r
    .task("observer-read")
    .run(async () => undefined)
    .build();
  const observer = new LiveObserver({
    query: query({
      task,
      topics: () => topic("observer"),
      batchWindowMs: options?.batchWindowMs,
      revalidateEveryMs: options?.revalidateEveryMs,
    }),
    topicKeys: ['["observer"]'],
    providerSubscribe: async (_topicKeys, nextListener) => {
      listener = nextListener;
      return options?.subscribe
        ? options.subscribe(nextListener)
        : async () => undefined;
    },
    isConnected: () => connected,
    serializer: new Serializer(),
    timers,
    run: options?.run ?? (async () => "value"),
    onEmpty: options?.onEmpty ?? (() => undefined),
  });

  return {
    observer,
    emit(event: LiveDataProviderEvent) {
      listener(event);
    },
    setConnected(value: boolean) {
      connected = value;
    },
    timeouts,
    intervals,
    timeoutCancels,
    intervalCancels,
  };
}

export function addQueue(observer: LiveObserver) {
  const serializer = new Serializer();
  const queue: LiveSubscriptionQueue<unknown> = new LiveSubscriptionQueue(
    serializer,
    () => observer.remove(queue),
  );
  observer.add(queue);
  return queue;
}
