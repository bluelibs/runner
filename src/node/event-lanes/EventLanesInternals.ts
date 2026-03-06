import { isResource } from "../../define";
import type { IEventEmission, IEventLaneTopologyProfile } from "../../defs";
import {
  eventLaneDuplicateBindingError,
  eventLaneBindingNotFoundError,
  eventLaneProfileNotFoundError,
  eventLaneQueueReferenceInvalidError,
  eventLaneRetryPolicyInvalidError,
} from "../../errors";
import type { EventLaneRoute } from "./EventLaneAssignments";
import type {
  EventLaneBinding,
  EventLaneQueueReference,
  EventLaneQueueResource,
  EventLanesResourceConfig,
  IEventLaneQueue,
} from "./types";
import { resolveRemoteLanesMode } from "../remote-lanes/mode";

const EVENT_LANE_QUEUE_DEPENDENCY_PREFIX = "__eventLaneQueue__:";
export const DEFAULT_RELAY_SOURCE_PREFIX = "runner.event-lanes.relay:";

export type EventLanesResolvedBinding = Omit<EventLaneBinding, "queue"> & {
  queue: IEventLaneQueue;
};

export interface EventLanesResourceContext {
  started: boolean;
  coolingDown: boolean;
  disposed: boolean;
  activeBindingsByQueue: Map<IEventLaneQueue, Set<string>>;
  bindingsByLaneId: Map<string, EventLanesResolvedBinding>;
  eventRouteByEventId: Map<string, EventLaneRoute>;
  queues: Set<IEventLaneQueue>;
  managedQueues: Set<IEventLaneQueue>;
  relaySourcePrefix: string;
  profile: string;
}

export type EventLanesLifecycleContext = {
  coolingDown: boolean;
  disposed?: boolean;
  activeBindingsByQueue: Map<IEventLaneQueue, Set<string>>;
  managedQueues?: Set<IEventLaneQueue>;
};

type EventLanesResolvedState = {
  bindings: EventLanesResolvedBinding[];
  managedQueues: Set<IEventLaneQueue>;
};

const defaultConfig: EventLanesResourceConfig = {
  profile: "default",
  topology: {
    profiles: { default: { consume: [] } },
    bindings: [],
  },
};

export function createDefaultEventLanesContext(): EventLanesResourceContext {
  return buildContext(defaultConfig, [], new Set(), new Map());
}

export function collectEventLaneQueueResourceDependencies(
  config: EventLanesResourceConfig,
): Record<string, EventLaneQueueResource> {
  if (resolveRemoteLanesMode(config.mode) !== "network") {
    return {};
  }

  const deps: Record<string, EventLaneQueueResource> = {};

  for (const binding of config.topology.bindings) {
    if (isResource(binding.queue)) {
      deps[toQueueDependencyKey(binding.queue.id)] = binding.queue;
    }
  }

  return deps;
}

export function resolveEventLaneBindings(
  config: EventLanesResourceConfig,
  dependencies: Record<string, unknown>,
): EventLanesResolvedState {
  const bindings: EventLanesResolvedBinding[] = [];
  const managedQueues = new Set<IEventLaneQueue>();
  const seenLaneIds = new Set<string>();

  for (const binding of config.topology.bindings) {
    if (seenLaneIds.has(binding.lane.id)) {
      eventLaneDuplicateBindingError.throw({
        laneId: binding.lane.id,
      });
    }
    seenLaneIds.add(binding.lane.id);
    validateBindingRetryPolicy(binding);

    const resolvedQueue = resolveQueueReference(binding.queue, dependencies);
    if (resolvedQueue.managed) managedQueues.add(resolvedQueue.queue);

    bindings.push({
      ...binding,
      queue: resolvedQueue.queue,
    });
  }

  return { bindings, managedQueues };
}

function validateBindingRetryPolicy(binding: EventLaneBinding): void {
  const { maxAttempts, retryDelayMs } = binding;

  if (
    maxAttempts !== undefined &&
    (!Number.isInteger(maxAttempts) || maxAttempts < 1)
  ) {
    eventLaneRetryPolicyInvalidError.throw({
      laneId: binding.lane.id,
      field: "maxAttempts",
      value: String(maxAttempts),
    });
  }

  if (
    retryDelayMs !== undefined &&
    (!Number.isFinite(retryDelayMs) || retryDelayMs < 0)
  ) {
    eventLaneRetryPolicyInvalidError.throw({
      laneId: binding.lane.id,
      field: "retryDelayMs",
      value: String(retryDelayMs),
    });
  }
}

export function buildEventLanesContext(
  config: EventLanesResourceConfig,
  bindings: EventLanesResolvedBinding[],
  managedQueues: Set<IEventLaneQueue>,
  eventRouteByEventId: Map<string, EventLaneRoute>,
): EventLanesResourceContext {
  return buildContext(config, bindings, managedQueues, eventRouteByEventId);
}

export function isRelayEmission(
  emission: IEventEmission<unknown>,
  relaySourcePrefix: string,
): boolean {
  return (
    emission.source.kind === "runtime" &&
    (emission.source.path ?? emission.source.id).startsWith(relaySourcePrefix)
  );
}

export function getLaneBindingOrThrow(
  laneId: string,
  bindingsByLaneId: Map<string, EventLanesResolvedBinding>,
): EventLanesResolvedBinding {
  const binding = bindingsByLaneId.get(laneId);
  if (!binding) {
    eventLaneBindingNotFoundError.throw({ laneId });
  }
  return binding!;
}

function toQueueDependencyKey(queueResourceId: string): string {
  return `${EVENT_LANE_QUEUE_DEPENDENCY_PREFIX}${queueResourceId}`;
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
  if (isEventLaneQueue(value)) {
    return value;
  }
  throw eventLaneQueueReferenceInvalidError.create({ source });
}

function resolveQueueReference(
  queueReference: EventLaneQueueReference,
  dependencies: Record<string, unknown>,
): { queue: IEventLaneQueue; managed: boolean } {
  if (isResource(queueReference)) {
    const dependencyKey = toQueueDependencyKey(queueReference.id);
    return {
      queue: requireEventLaneQueue(dependencies[dependencyKey], dependencyKey),
      managed: false,
    };
  }

  return {
    queue: requireEventLaneQueue(queueReference, "binding.queue"),
    managed: true,
  };
}

function resolveProfile(
  config: EventLanesResourceConfig,
): IEventLaneTopologyProfile {
  const profile = config.topology.profiles[config.profile];
  if (!profile) {
    eventLaneProfileNotFoundError.throw({ profile: config.profile });
  }
  return profile;
}

function shouldConsumeProfile(config: EventLanesResourceConfig): boolean {
  if (resolveRemoteLanesMode(config.mode) !== "network") {
    return false;
  }
  resolveProfile(config);
  return true;
}

function buildContext(
  config: EventLanesResourceConfig,
  bindings: EventLanesResolvedBinding[],
  managedQueues: Set<IEventLaneQueue>,
  eventRouteByEventId: Map<string, EventLaneRoute>,
): EventLanesResourceContext {
  const bindingsByLaneId = new Map<string, EventLanesResolvedBinding>();
  const queues = new Set<IEventLaneQueue>();

  for (const binding of bindings) {
    bindingsByLaneId.set(binding.lane.id, binding);
    queues.add(binding.queue);
  }

  const activeBindingsByQueue = new Map<IEventLaneQueue, Set<string>>();
  if (shouldConsumeProfile(config)) {
    const profile = resolveProfile(config);
    for (const lane of profile.consume) {
      const binding = getLaneBindingOrThrow(lane.id, bindingsByLaneId);
      const activeLaneIds =
        activeBindingsByQueue.get(binding.queue) ?? new Set<string>();
      activeLaneIds.add(lane.id);
      activeBindingsByQueue.set(binding.queue, activeLaneIds);
    }
  }

  return {
    started: false,
    coolingDown: false,
    disposed: false,
    activeBindingsByQueue,
    bindingsByLaneId,
    eventRouteByEventId,
    queues,
    managedQueues,
    relaySourcePrefix:
      config.topology.relaySourcePrefix ?? DEFAULT_RELAY_SOURCE_PREFIX,
    profile: config.profile,
  };
}
