import type {
  AnyTask,
  ExtractTaskInput,
  IAsyncContext,
  ResolveTaskOutput,
} from "../../defs";
import type { SerializerLike } from "../../serializer";
import type { ITimers } from "../../types/timers";
import { runtimeSource } from "../../types/runtimeSource";
import type { Store } from "../../models/store/Store";
import type { TaskRunner } from "../../models/TaskRunner";
import { validationError } from "../../errors";
import { LiveObserver } from "./observer";
import { createSharedObserverKey } from "./observerIdentity";
import { LiveSubscriptionQueue } from "./subscription";
import { normalizeTopics, topicKey } from "./topic";
import { cloneLiveValue } from "./serialization";
import { createLiveDispatchScope } from "./dispatchScope";
import { throwStartupCleanupError } from "./startupCleanupError";
import {
  captureContextBindings,
  withContextBindings,
  type ContextBinding,
} from "./contextBindings";
import type {
  LiveData,
  LiveDataProvider,
  LiveQuery,
  LiveSubscription,
  LiveTopic,
} from "./types";

type QueryRegistration = {
  canonicalTask: AnyTask;
  taskId: string;
  queryId: number;
};

export interface LiveDataServiceConfig {
  resourceId: string;
  queries: readonly LiveQuery[];
  provider: LiveDataProvider;
  serializer: SerializerLike;
  store: Store;
  taskRunner: TaskRunner;
  timers: ITimers;
  identityContext: IAsyncContext<any>;
}

export class LiveDataService implements LiveData {
  private readonly registrations = new Map<LiveQuery, QueryRegistration>();
  private readonly observers = new Map<string, LiveObserver>();
  private readonly retiringObservers = new Set<Promise<void>>();
  private readonly dispatchScope = createLiveDispatchScope();
  private disposePromise?: Promise<void>;
  private nextObserverId = 0;
  private disposed = false;

  constructor(private readonly config: LiveDataServiceConfig) {
    config.queries.forEach((query, queryId) => {
      const taskId = config.store.findIdByDefinition(query.task);
      if (!config.store.isItemVisibleToConsumer(taskId, config.resourceId)) {
        invalidLiveData(
          `Task "${taskId}" is not visible to "${config.resourceId}".`,
        );
      }
      for (const context of query.asyncContexts) {
        const contextId = config.store.findIdByDefinition(context);
        if (
          !config.store.isItemVisibleToConsumer(contextId, config.resourceId)
        ) {
          invalidLiveData(
            `Async context "${contextId}" is not visible to "${config.resourceId}".`,
          );
        }
      }
      this.registrations.set(query, {
        canonicalTask: config.store.resolveRegisteredDefinition(query.task),
        taskId,
        queryId,
      });
    });
  }

  async subscribe<TTask extends AnyTask>(
    query: LiveQuery<TTask>,
    input: ExtractTaskInput<TTask>,
    options?: { signal?: AbortSignal },
  ): Promise<LiveSubscription<ResolveTaskOutput<TTask>>> {
    if (this.disposed) invalidLiveData("Cannot subscribe after disposal.");
    options?.signal?.throwIfAborted();
    const registration = this.registrations.get(query);
    if (!registration) {
      invalidLiveData(
        "The query is not registered in resources.liveData.with({ queries }).",
      );
    }

    const rawInput = cloneValue(input, this.config.serializer);
    const normalizedInput = registration.canonicalTask.inputSchema
      ? registration.canonicalTask.inputSchema.parse(
          cloneValue(rawInput, this.config.serializer),
        )
      : cloneValue(rawInput, this.config.serializer);
    const bindings = captureContextBindings(
      query,
      this.config.identityContext,
      this.config.store,
      this.config.serializer,
    );
    const topics = await withContextBindings(
      bindings,
      this.config.serializer,
      () => query.topics(cloneValue(normalizedInput, this.config.serializer)),
    );
    if (this.disposed) invalidLiveData("Cannot subscribe after disposal.");
    options?.signal?.throwIfAborted();
    const topicKeys = normalizeTopics(topics).map(topicKey);
    if (!this.config.provider.connected) {
      invalidLiveData(
        "Cannot start a subscription while its provider is disconnected.",
      );
    }
    const observerKey = query.share
      ? createSharedObserverKey(this.config.serializer, {
          queryId: registration.queryId,
          taskId: registration.taskId,
          rawInput,
          normalizedInput,
          contextValues: bindings.map(({ canonicalId, present, value }) => [
            canonicalId,
            present,
            value,
          ]),
          topicKeys,
        })
      : `private:${this.nextObserverId++}`;
    let observer = this.observers.get(observerKey);
    let queue!: LiveSubscriptionQueue<unknown>;

    if (!observer) {
      observer = this.createObserver(
        observerKey,
        registration,
        query,
        rawInput,
        bindings,
        topicKeys,
      );
      this.observers.set(observerKey, observer);
      queue = this.createQueue(observer, options?.signal);
      observer.add(queue);
      try {
        await observer.ensureStarted();
      } catch (error) {
        if (this.observers.get(observerKey) === observer) {
          this.observers.delete(observerKey);
        }
        let cleanupFailure: unknown;
        try {
          await observer.close();
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
        options?.signal?.throwIfAborted();
        if (cleanupFailure !== undefined) {
          throwStartupCleanupError(registration.taskId, error, cleanupFailure);
        }
        throw error;
      }
    } else {
      queue = this.createQueue(observer, options?.signal);
      observer.add(queue);
      await observer.ensureStarted();
    }

    const signal = options?.signal;
    if (this.disposed || signal?.aborted) {
      await queue.close();
      if (this.disposed) invalidLiveData("Cannot subscribe after disposal.");
      signal?.throwIfAborted();
    }

    return queue as LiveSubscription<ResolveTaskOutput<TTask>>;
  }

  async invalidate(topics: LiveTopic | readonly LiveTopic[]): Promise<void> {
    if (this.disposed) invalidLiveData("Cannot invalidate after disposal.");
    await this.config.provider.publish(normalizeTopics(topics).map(topicKey));
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = this.closeObservers();
    return this.disposePromise;
  }

  private createObserver(
    observerKey: string,
    registration: QueryRegistration,
    query: LiveQuery,
    input: unknown,
    bindings: readonly ContextBinding[],
    topicKeys: readonly string[],
  ): LiveObserver {
    const observer: LiveObserver = new LiveObserver({
      query,
      topicKeys,
      providerSubscribe: (topics, listener) =>
        this.config.provider.subscribe(topics, listener),
      isConnected: () => this.config.provider.connected,
      serializer: this.config.serializer,
      timers: this.config.timers,
      run: (signal) =>
        this.dispatchScope.run(() =>
          withContextBindings(bindings, this.config.serializer, () =>
            this.config.taskRunner.run(
              registration.canonicalTask,
              cloneValue(input, this.config.serializer),
              {
                source: runtimeSource.resource(this.config.resourceId),
                signal,
              },
            ),
          ),
        ),
      onEmpty: () => {
        this.retireObserver(observerKey, observer);
      },
    });
    return observer;
  }

  private async closeObservers(): Promise<void> {
    try {
      const activeClosures = [...this.observers.values()].map((observer) =>
        observer.close(),
      );
      const results = await Promise.allSettled([
        ...activeClosures,
        ...this.retiringObservers,
      ]);
      this.observers.clear();
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    } finally {
      this.dispatchScope.dispose();
    }
  }

  private retireObserver(observerKey: string, observer: LiveObserver): void {
    if (this.observers.get(observerKey) === observer) {
      this.observers.delete(observerKey);
    }
    const cleanup = observer.close();
    this.retiringObservers.add(cleanup);
    const forget = () => this.retiringObservers.delete(cleanup);
    cleanup.then(forget, forget);
  }

  private createQueue(
    observer: LiveObserver,
    signal?: AbortSignal,
  ): LiveSubscriptionQueue<unknown> {
    const queue: LiveSubscriptionQueue<unknown> = new LiveSubscriptionQueue(
      this.config.serializer,
      () => observer.remove(queue),
      signal,
    );
    return queue;
  }
}

function cloneValue<T>(value: T, serializer: SerializerLike): T {
  return cloneLiveValue(value, serializer);
}

function invalidLiveData(message: string): never {
  return validationError.throw({
    subject: "Live data",
    id: "liveData",
    originalError: message,
  });
}
