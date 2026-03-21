import { isResource } from "../../define";
import { eventLaneSharedQueuePartialConsumeError } from "../../errors";
import type { ValidatorContext } from "./ValidatorContext";

type EventLanesConsumeEntryLike = {
  lane?: { id?: string };
};

type EventLanesBindingLike = {
  lane?: { id?: string };
  queue?: unknown;
};

type EventLanesProfileLike = {
  consume?: EventLanesConsumeEntryLike[];
};

type EventLanesConfigLike = {
  topology?: {
    profiles?: Record<string, EventLanesProfileLike>;
    bindings?: EventLanesBindingLike[];
  };
};

const EVENT_LANES_RESOURCE_ID = "eventLanes";

/**
 * Validates that shared-queue consumers take every lane bound to each queue.
 *
 * @param ctx - Validator context with access to the resource registry.
 * @throws `eventLaneSharedQueuePartialConsumeError` when a profile consumes
 * only part of a shared queue's bound lanes.
 * @returns void
 */
export function validateSharedQueueConsumeTopology(
  ctx: ValidatorContext,
): void {
  forEachEventLanesResource(ctx, ({ resourceId, config }) => {
    const topology = (config as EventLanesConfigLike).topology;
    const profiles = topology?.profiles ?? {};
    const bindings = topology?.bindings ?? [];
    const boundLaneIdsByQueue = collectBoundLaneIdsByQueue(ctx, bindings);

    for (const [profile, profileConfig] of Object.entries(profiles)) {
      const consumedLaneIdsByQueue = collectConsumedLaneIdsByQueue(
        profileConfig.consume ?? [],
        boundLaneIdsByQueue,
      );

      for (const [queueIdentity, consumedLaneIds] of consumedLaneIdsByQueue) {
        const boundLaneIds = boundLaneIdsByQueue.get(queueIdentity);
        if (!boundLaneIds || boundLaneIds.size <= 1) {
          continue;
        }

        if (areEqualSets(consumedLaneIds, boundLaneIds)) {
          continue;
        }

        eventLaneSharedQueuePartialConsumeError.throw({
          resourceId,
          profile,
          queueSource: describeQueueSource(ctx, bindings, queueIdentity),
          consumedLaneIds: Array.from(consumedLaneIds).sort(),
          queueLaneIds: Array.from(boundLaneIds).sort(),
        });
      }
    }
  });
}

function collectBoundLaneIdsByQueue(
  ctx: ValidatorContext,
  bindings: readonly EventLanesBindingLike[],
): Map<unknown, Set<string>> {
  const result = new Map<unknown, Set<string>>();

  for (const binding of bindings) {
    const laneId = binding.lane?.id;
    if (!laneId || binding.queue === undefined) {
      continue;
    }

    const queueIdentity = toQueueIdentity(ctx, binding.queue);
    const laneIds = result.get(queueIdentity) ?? new Set<string>();
    laneIds.add(laneId);
    result.set(queueIdentity, laneIds);
  }

  return result;
}

function collectConsumedLaneIdsByQueue(
  consume: readonly EventLanesConsumeEntryLike[],
  boundLaneIdsByQueue: ReadonlyMap<unknown, Set<string>>,
): Map<unknown, Set<string>> {
  const queueIdentityByLaneId = new Map<string, unknown>();
  for (const [queueIdentity, laneIds] of boundLaneIdsByQueue.entries()) {
    for (const laneId of laneIds) {
      queueIdentityByLaneId.set(laneId, queueIdentity);
    }
  }

  const result = new Map<unknown, Set<string>>();
  for (const entry of consume) {
    const laneId = entry.lane?.id;
    if (!laneId) {
      continue;
    }

    const queueIdentity = queueIdentityByLaneId.get(laneId);
    if (queueIdentity === undefined) {
      continue;
    }

    const consumedLaneIds = result.get(queueIdentity) ?? new Set<string>();
    consumedLaneIds.add(laneId);
    result.set(queueIdentity, consumedLaneIds);
  }

  return result;
}

function describeQueueSource(
  ctx: ValidatorContext,
  bindings: readonly EventLanesBindingLike[],
  queueIdentity: unknown,
): string {
  const binding = bindings.find(
    (candidate) =>
      candidate.queue !== undefined &&
      toQueueIdentity(ctx, candidate.queue) === queueIdentity,
  );
  const queue = binding?.queue;
  if (!queue) {
    return "unknown queue";
  }

  if (isResource(queue)) {
    return ctx.findIdByDefinition(queue);
  }

  const constructorName = (queue as { constructor?: { name?: string } })
    .constructor?.name;
  return constructorName && constructorName !== "Object"
    ? constructorName
    : "binding.queue";
}

function toQueueIdentity(ctx: ValidatorContext, queue: unknown): unknown {
  return isResource(queue) ? ctx.findIdByDefinition(queue) : queue;
}

function areEqualSets<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return (
    left.size === right.size &&
    Array.from(left).every((value) => right.has(value))
  );
}

function forEachEventLanesResource(
  ctx: ValidatorContext,
  callback: (entry: { resourceId: string; config: unknown }) => void,
): void {
  for (const { resource, config } of ctx.registry.resources.values()) {
    const resourceId = ctx.findIdByDefinition(resource);
    if (
      resourceId !== EVENT_LANES_RESOURCE_ID &&
      !resourceId.endsWith(`.${EVENT_LANES_RESOURCE_ID}`)
    ) {
      continue;
    }

    callback({ resourceId, config });
  }
}
