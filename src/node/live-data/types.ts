import type {
  AnyTask,
  ExtractTaskInput,
  IAsyncContext,
  IResource,
  IResourceWithConfig,
  ResolveTaskOutput,
} from "../../defs";

/** An exact live-data routing key made from unambiguous string segments. */
export interface LiveTopic {
  /** Ordered segments compared as one exact topic identity. */
  readonly segments: readonly string[];
}

/** A newly read value delivered by a live query. */
export interface LiveSnapshot<T> {
  /** Discriminator for a fresh query result. */
  readonly type: "snapshot";
  /** Observer-local revision incremented for each delivered snapshot. */
  readonly revision: number;
  /** Independently deserialized task result for this subscriber. */
  readonly data: T;
}

/** A marker indicating that the current value must not be treated as fresh. */
export interface LiveStale {
  /** Discriminator for a freshness-loss marker. */
  readonly type: "stale";
  /** Transport condition that caused freshness guarantees to be lost. */
  readonly reason: "bus-disconnected";
}

/** Values emitted by a live subscription. */
export type LiveSubscriptionEvent<T> = LiveSnapshot<T> | LiveStale;

/** Awaitable async iterator returned by {@link LiveData.subscribe}. */
export interface LiveSubscription<T> extends AsyncIterableIterator<
  LiveSubscriptionEvent<T>
> {
  /** Stops iteration and releases this subscriber. */
  return(): Promise<IteratorResult<LiveSubscriptionEvent<T>>>;
  /** Stops this subscriber and releases its observer when it is the last subscriber. */
  close(): Promise<void>;
}

/** Declarative binding between an ordinary Runner task and its invalidation topics. */
export interface LiveQuery<TTask extends AnyTask = AnyTask> {
  /** Ordinary registered Runner task used for every read. */
  readonly task: TTask;
  /** Exact topics whose invalidation should re-run this task and input. */
  readonly topics: (
    input: ExtractTaskInput<TTask>,
  ) => LiveTopic | readonly LiveTopic[];
  /** Whether equivalent subscribers reuse one observer within this runtime. */
  readonly share: boolean;
  /** Delay used to coalesce bursts of invalidations before reading. */
  readonly batchWindowMs: number;
  /** Optional periodic revalidation interval. */
  readonly revalidateEveryMs?: number;
  /** Additional business contexts captured when subscribing and restored on reads. */
  readonly asyncContexts: readonly IAsyncContext<any>[];
}

/** Options accepted when defining a live query. */
export interface LiveQueryOptions<TTask extends AnyTask> {
  /** Ordinary Runner task to execute through the runtime pipeline. */
  task: TTask;
  /** Resolves exact invalidation topics from validated task input. */
  topics: (input: ExtractTaskInput<TTask>) => LiveTopic | readonly LiveTopic[];
  /** Reuse equivalent observers within one runtime. Defaults to `false`. */
  share?: boolean;
  /** Invalidation coalescing delay in milliseconds. Defaults to `0`. */
  batchWindowMs?: number;
  /** Optional interval for reads even when no invalidation arrives. */
  revalidateEveryMs?: number;
  /** Business contexts to capture in addition to Runner identity. */
  asyncContexts?: readonly IAsyncContext<any>[];
}

/** Provider notification delivered after subscription readiness. */
export type LiveDataProviderEvent =
  | { readonly type: "invalidate"; readonly topics: readonly string[] }
  | { readonly type: "disconnect" }
  | { readonly type: "resync" };

/** Runtime invalidation bus used by the live-data service. */
export interface LiveDataProvider {
  /** Whether the bus currently provides fresh invalidation guarantees. */
  readonly connected: boolean;
  /** Publishes an invalidation and surfaces transport failures. */
  publish(topicKeys: readonly string[]): Promise<void>;
  /** Installs listeners and resolves only after transport subscriptions are ready. */
  subscribe(
    topicKeys: readonly string[],
    listener: (event: LiveDataProviderEvent) => void,
  ): Promise<() => Promise<void>>;
  /** Closes provider-owned transport state. */
  dispose(): Promise<void>;
}

type LiveDataProviderDefinition = IResource<
  any,
  Promise<LiveDataProvider>,
  any,
  any,
  any,
  any,
  any
>;

/** Resource definition or configured resource that initializes a live-data provider. */
export type LiveDataProviderResource =
  | LiveDataProviderDefinition
  | IResourceWithConfig<
      any,
      Promise<LiveDataProvider>,
      any,
      any,
      any,
      any,
      any
    >;

/** Configuration for the built-in live-data resource. */
export interface LiveDataConfig {
  /** Complete list of query bindings allowed through this resource instance. */
  queries: readonly LiveQuery[];
  /** Optional provider resource; isolated memory is used when omitted. */
  provider?: LiveDataProviderResource;
}

/** Per-subscriber controls. */
export interface LiveSubscribeOptions {
  /** Cancels and closes only this subscriber. */
  signal?: AbortSignal;
}

/** Per-runtime live-data API exposed by `resources.liveData`. */
export interface LiveData {
  /** Starts observing a registered query and buffers its initial snapshot. */
  subscribe<TTask extends AnyTask>(
    query: LiveQuery<TTask>,
    input: ExtractTaskInput<TTask>,
    options?: LiveSubscribeOptions,
  ): Promise<LiveSubscription<ResolveTaskOutput<TTask>>>;
  /** Publishes one or more exact invalidation topics. */
  invalidate(topics: LiveTopic | readonly LiveTopic[]): Promise<void>;
}
