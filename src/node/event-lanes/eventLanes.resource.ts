import { globals, r } from "../../index";
import { isResource } from "../../define";
import {
  createMessageError,
  eventLaneBindingNotFoundError,
  eventLaneEventNotRegisteredError,
  eventLaneProfileNotFoundError,
} from "../../errors";
import type { IEventEmission, IEventLaneDefinition } from "../../defs";
import { runtimeSource } from "../../types/runtimeSource";
import type {
  EventLaneBinding,
  EventLaneQueueReference,
  EventLaneQueueResource,
  EventLanesProfileId,
  EventLanesResourceConfig,
  EventLanesTopology,
  IEventLaneQueue,
} from "./types";

const DEFAULT_RELAY_SOURCE_PREFIX = "runner.event-lanes.relay:";
const EVENT_LANE_QUEUE_DEPENDENCY_PREFIX = "__eventLaneQueue__:";

type EventLanesResolvedBinding = Omit<EventLaneBinding, "queue" | "dlq"> & {
  queue: IEventLaneQueue;
  dlq?: { queue: IEventLaneQueue };
};

interface EventLanesResourceContext {
  started: boolean;
  disposed: boolean;
  activeBindingsByQueue: Map<IEventLaneQueue, Set<string>>;
  bindingsByLaneReference: Map<IEventLaneDefinition, EventLanesResolvedBinding>;
  bindingsByLaneId: Map<string, EventLanesResolvedBinding>;
  queues: Set<IEventLaneQueue>;
  managedQueues: Set<IEventLaneQueue>;
  relaySourcePrefix: string;
  profile: string;
}

function getLaneBindingOrThrow(
  lane: IEventLaneDefinition,
  bindingsByLaneReference: Map<IEventLaneDefinition, EventLanesResolvedBinding>,
): EventLanesResolvedBinding {
  const binding = bindingsByLaneReference.get(lane);
  if (!binding) {
    eventLaneBindingNotFoundError.throw({ laneId: lane.id });
  }
  return binding!;
}

function toQueueDependencyKey(queueResourceId: string): string {
  return `${EVENT_LANE_QUEUE_DEPENDENCY_PREFIX}${queueResourceId}`;
}

function collectQueueResourceDependencies(
  config: EventLanesResourceConfig,
): Record<string, EventLaneQueueResource> {
  const deps: Record<string, EventLaneQueueResource> = {};

  for (const binding of config.topology.bindings) {
    if (isResource(binding.queue)) {
      deps[toQueueDependencyKey(binding.queue.id)] = binding.queue;
    }

    const dlqQueue = binding.dlq?.queue;
    if (dlqQueue && isResource(dlqQueue)) {
      deps[toQueueDependencyKey(dlqQueue.id)] = dlqQueue;
    }
  }

  return deps;
}

function isQueueResourceReference(
  queueReference: EventLaneQueueReference,
): queueReference is EventLaneQueueResource {
  return isResource(queueReference);
}

function isEventLaneQueue(value: unknown): value is IEventLaneQueue {
  if (!value || typeof value !== "object") {
    return false;
  }

  const queue = value as Partial<IEventLaneQueue>;
  return (
    typeof queue.enqueue === "function" &&
    typeof queue.consume === "function" &&
    typeof queue.ack === "function" &&
    typeof queue.nack === "function"
  );
}

function requireEventLaneQueue(
  value: unknown,
  source: string,
): IEventLaneQueue {
  if (!isEventLaneQueue(value)) {
    throw createMessageError(
      `Event lanes queue reference "${source}" did not resolve to a valid IEventLaneQueue instance.`,
    );
  }
  return value;
}

function resolveQueueReference(
  queueReference: EventLaneQueueReference,
  dependencies: Record<string, unknown>,
): { queue: IEventLaneQueue; managed: boolean } {
  if (isQueueResourceReference(queueReference)) {
    const dependencyKey = toQueueDependencyKey(queueReference.id);
    const resolved = dependencies[dependencyKey];
    return {
      queue: requireEventLaneQueue(resolved, dependencyKey),
      managed: false,
    };
  }

  return {
    queue: requireEventLaneQueue(queueReference, "binding.queue"),
    managed: true,
  };
}

function resolveBindings(
  config: EventLanesResourceConfig,
  dependencies: Record<string, unknown>,
): {
  bindings: EventLanesResolvedBinding[];
  managedQueues: Set<IEventLaneQueue>;
} {
  const bindings: EventLanesResolvedBinding[] = [];
  const managedQueues = new Set<IEventLaneQueue>();
  const seenLaneIds = new Set<string>();

  for (const binding of config.topology.bindings) {
    if (seenLaneIds.has(binding.lane.id)) {
      throw createMessageError(
        `Event lane "${binding.lane.id}" is bound multiple times. Define exactly one queue binding per lane.`,
      );
    }
    seenLaneIds.add(binding.lane.id);

    const resolvedQueue = resolveQueueReference(binding.queue, dependencies);
    if (resolvedQueue.managed) {
      managedQueues.add(resolvedQueue.queue);
    }

    let resolvedDlqQueue: IEventLaneQueue | undefined;
    if (binding.dlq?.queue) {
      const dlqQueue = resolveQueueReference(binding.dlq.queue, dependencies);
      resolvedDlqQueue = dlqQueue.queue;
      if (dlqQueue.managed) {
        managedQueues.add(dlqQueue.queue);
      }
    }

    bindings.push({
      ...binding,
      queue: resolvedQueue.queue,
      dlq: resolvedDlqQueue ? { queue: resolvedDlqQueue } : undefined,
    });
  }

  return { bindings, managedQueues };
}

function isRelayEmission(
  emission: IEventEmission<unknown>,
  relaySourcePrefix: string,
): boolean {
  return (
    emission.source.kind === "runtime" &&
    emission.source.id.startsWith(relaySourcePrefix)
  );
}

function resolveProfile(config: EventLanesResourceConfig) {
  const profile = config.topology.profiles[config.profile];
  if (!profile) {
    eventLaneProfileNotFoundError.throw({ profile: config.profile });
  }
  return profile;
}

function shouldConsumeProfile(config: EventLanesResourceConfig): boolean {
  resolveProfile(config);
  return config.mode !== "producer";
}

function resolveRelayLaneId(
  event: IEventEmission<unknown>,
  relaySourcePrefix: string,
): string | undefined {
  if (!isRelayEmission(event, relaySourcePrefix)) {
    return undefined;
  }

  const relayTail = event.source.id.slice(relaySourcePrefix.length);
  const separatorIndex = relayTail.lastIndexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }
  return relayTail.slice(separatorIndex + 1);
}

function buildContext(
  config: EventLanesResourceConfig,
  bindings: EventLanesResolvedBinding[],
  managedQueues: Set<IEventLaneQueue>,
): EventLanesResourceContext {
  const bindingsByLaneReference = new Map<
    IEventLaneDefinition,
    EventLanesResolvedBinding
  >();
  const bindingsByLaneId = new Map<string, EventLanesResolvedBinding>();
  const queues = new Set<IEventLaneQueue>();

  for (const binding of bindings) {
    bindingsByLaneReference.set(binding.lane, binding);
    bindingsByLaneId.set(binding.lane.id, binding);
    queues.add(binding.queue);
    if (binding.dlq?.queue) {
      queues.add(binding.dlq.queue);
    }
  }

  const activeBindingsByQueue = new Map<IEventLaneQueue, Set<string>>();
  if (shouldConsumeProfile(config)) {
    const profile = resolveProfile(config);
    for (const lane of profile.consume) {
      const binding = getLaneBindingOrThrow(lane, bindingsByLaneReference);
      const activeLaneIds =
        activeBindingsByQueue.get(binding.queue) ?? new Set<string>();
      activeLaneIds.add(lane.id);
      activeBindingsByQueue.set(binding.queue, activeLaneIds);
    }
  }

  return {
    started: false,
    disposed: false,
    activeBindingsByQueue,
    bindingsByLaneReference,
    bindingsByLaneId,
    queues,
    managedQueues,
    relaySourcePrefix:
      config.topology.relaySourcePrefix ?? DEFAULT_RELAY_SOURCE_PREFIX,
    profile: config.profile,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const eventLanesResourceBase = r
  .resource<EventLanesResourceConfig>("globals.resources.node.eventLanes")
  .dependencies({
    eventManager: globals.resources.eventManager,
    serializer: globals.resources.serializer,
    store: globals.resources.store,
    logger: globals.resources.logger,
  })
  .dependencies((config) => collectQueueResourceDependencies(config))
  .context<EventLanesResourceContext>(() =>
    buildContext(
      {
        profile: "default",
        topology: {
          profiles: { default: { consume: [] } },
          bindings: [],
        },
      },
      [],
      new Set(),
    ),
  )
  .init(async (config, dependencies, ctx) => {
    const { eventManager, serializer, store, logger } = dependencies;
    const resolved = resolveBindings(
      config,
      dependencies as unknown as Record<string, unknown>,
    );
    Object.assign(
      ctx,
      buildContext(config, resolved.bindings, resolved.managedQueues),
    );

    for (const queue of ctx.managedQueues) {
      await queue.init?.();
    }

    eventManager.interceptHook(async (next, hook, event) => {
      const relayLaneId = resolveRelayLaneId(event, ctx.relaySourcePrefix);
      if (!relayLaneId) {
        return next(hook, event);
      }

      const hookLaneConfig = globals.tags.eventLaneHook.extract(hook.tags);
      if (!hookLaneConfig) {
        return next(hook, event);
      }

      if (hookLaneConfig.lane.id !== relayLaneId) {
        return;
      }

      return next(hook, event);
    });

    eventManager.intercept(async (next, emission) => {
      if (isRelayEmission(emission, ctx.relaySourcePrefix)) {
        return next(emission);
      }

      const laneConfig = globals.tags.eventLane.extract(emission.tags);
      if (!laneConfig) {
        return next(emission);
      }

      const binding = getLaneBindingOrThrow(
        laneConfig.lane,
        ctx.bindingsByLaneReference,
      );
      emission.stopPropagation();

      await binding.queue.enqueue({
        laneId: laneConfig.lane.id,
        eventId: emission.id,
        payload: serializer.stringify(emission.data),
        source: emission.source,
        orderingKey: laneConfig.orderingKey,
        metadata: laneConfig.metadata,
        maxAttempts: 1,
      });
    });

    eventManager.addListener(
      globals.events.ready,
      async () => {
        if (ctx.started || ctx.disposed) {
          return;
        }
        ctx.started = true;

        for (const [queue, laneIds] of ctx.activeBindingsByQueue) {
          let resolvedPrefetch: number | undefined;
          for (const laneId of laneIds) {
            const binding = ctx.bindingsByLaneId.get(laneId)!;
            const candidatePrefetch = binding.prefetch;
            if (candidatePrefetch === undefined || candidatePrefetch < 1) {
              continue;
            }
            resolvedPrefetch = Math.max(
              resolvedPrefetch ?? 0,
              candidatePrefetch,
            );
          }

          if (resolvedPrefetch !== undefined) {
            await queue.setPrefetch?.(resolvedPrefetch);
          }
        }

        for (const [queue, activeLaneIds] of ctx.activeBindingsByQueue) {
          await queue.consume(async (message) => {
            if (ctx.disposed) {
              await queue.nack(message.id, true);
              return;
            }

            if (!activeLaneIds.has(message.laneId)) {
              await queue.nack(message.id, true);
              return;
            }

            const binding = ctx.bindingsByLaneId.get(message.laneId)!;

            try {
              const eventStoreEntry = store.events.get(message.eventId);
              if (!eventStoreEntry) {
                eventLaneEventNotRegisteredError.throw({
                  eventId: message.eventId,
                });
              }

              const payload = serializer.parse(message.payload);
              await eventManager.emit(
                eventStoreEntry!.event,
                payload,
                runtimeSource.runtime(
                  `${ctx.relaySourcePrefix}${ctx.profile}:${message.laneId}`,
                ),
              );
              await queue.ack(message.id);
            } catch (error) {
              if (binding.dlq?.queue) {
                await binding.dlq.queue.enqueue({
                  laneId: message.laneId,
                  eventId: message.eventId,
                  payload: message.payload,
                  source: message.source,
                  orderingKey: message.orderingKey,
                  maxAttempts: 1,
                  metadata: {
                    ...(message.metadata || {}),
                    eventLaneDlq: {
                      failedAt: new Date().toISOString(),
                      reason: normalizeErrorMessage(error),
                    },
                  },
                });
              }

              await queue.nack(message.id, false);
              await logger.error("Event lane consumer failed.", {
                laneId: message.laneId,
                eventId: message.eventId,
                error:
                  error instanceof Error ? error : new Error(String(error)),
              });
            }
          });
        }
      },
      { id: `${ctx.profile}.event-lanes.ready` },
    );

    return {
      profile: config.profile,
      consumers: Array.from(ctx.activeBindingsByQueue.values()).reduce(
        (count, laneIds) => count + laneIds.size,
        0,
      ),
    };
  })
  .dispose(async (_value, _config, _deps, ctx) => {
    ctx.disposed = true;
    for (const queue of ctx.managedQueues) {
      await queue.dispose?.();
    }
  })
  .build();

type EventLanesResourceTypedWith = {
  with<
    const TTopology extends EventLanesTopology,
    const TProfile extends EventLanesProfileId<TTopology>,
  >(
    config: EventLanesResourceConfig<TTopology, TProfile>,
  ): ReturnType<typeof eventLanesResourceBase.with>;
};

export const eventLanesResource = eventLanesResourceBase as Omit<
  typeof eventLanesResourceBase,
  "with"
> &
  EventLanesResourceTypedWith;
