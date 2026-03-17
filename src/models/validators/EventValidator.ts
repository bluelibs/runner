import {
  eventLaneConsumeDuplicateLaneError,
  eventLaneHookPolicyHookReferenceInvalidError,
  eventLaneHookPolicyConflictError,
  eventLaneHookTagDeprecatedError,
  eventLaneTagDeprecatedError,
  transactionalParallelConflictError,
} from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { ValidatorContext } from "./ValidatorContext";

const EVENT_LANES_RESOURCE_ID = "eventLanes";

type EventLaneHookPolicyConflict = {
  profile: string;
  laneId: string;
};

type EventLanesConsumeEntryLike = {
  lane?: { id?: string };
  hooks?: { only?: readonly unknown[] };
};

type EventLanesProfileLike = {
  consume?: EventLanesConsumeEntryLike[];
};

type EventLanesConfigLike = {
  topology?: {
    profiles?: Record<string, EventLanesProfileLike>;
  };
};

/**
 * Validates event constraints:
 * - Transactional events cannot be parallel
 * - Deprecated Event Lane tags fail fast
 * - Event Lane topology hook policy must be unambiguous and reference registered hooks
 */
export function validateEventConstraints(ctx: ValidatorContext): void {
  validateTransactionalEvents(ctx);
  validateDeprecatedEventLaneTags(ctx);
  validateDeprecatedEventLaneHookTags(
    ctx,
    validateEventLaneTopologyPolicies(ctx),
  );
}

function validateTransactionalEvents(ctx: ValidatorContext): void {
  for (const { event } of ctx.registry.events.values()) {
    if (!event.transactional) {
      continue;
    }

    if (event.parallel) {
      transactionalParallelConflictError.throw({
        eventId: event.id,
      });
    }
  }
}

function validateDeprecatedEventLaneTags(ctx: ValidatorContext): void {
  for (const { event } of ctx.registry.events.values()) {
    if (!globalTags.eventLane.exists(event)) {
      continue;
    }

    eventLaneTagDeprecatedError.throw({
      eventId: event.id,
      tagId: globalTags.eventLane.id,
    });
  }
}

function validateDeprecatedEventLaneHookTags(
  ctx: ValidatorContext,
  conflictingPolicies: EventLaneHookPolicyConflict[],
): void {
  for (const { hook } of ctx.registry.hooks.values()) {
    if (!globalTags.eventLaneHook.exists(hook)) {
      continue;
    }

    const conflictingPolicy = conflictingPolicies[0];
    if (conflictingPolicy) {
      eventLaneHookPolicyConflictError.throw({
        hookId: hook.id,
        tagId: globalTags.eventLaneHook.id,
        profile: conflictingPolicy.profile,
        laneId: conflictingPolicy.laneId,
      });
    }

    eventLaneHookTagDeprecatedError.throw({
      hookId: hook.id,
      tagId: globalTags.eventLaneHook.id,
    });
  }
}

function validateEventLaneTopologyPolicies(
  ctx: ValidatorContext,
): EventLaneHookPolicyConflict[] {
  const conflicts: EventLaneHookPolicyConflict[] = [];

  forEachEventLanesProfileConsumeEntry(
    ctx,
    ({ resourceId, profile, entry }) => {
      const laneId = entry.lane?.id ?? "unknown";

      if (entry.hooks?.only === undefined) {
        return;
      }

      conflicts.push({
        profile,
        laneId,
      });
      validateEventLaneHookPolicyReferences({
        ctx,
        resourceId,
        profile,
        laneId,
        hooksOnly: entry.hooks.only ?? [],
      });
    },
  );

  return conflicts;
}

function validateEventLaneHookPolicyReferences(options: {
  ctx: ValidatorContext;
  resourceId: string;
  profile: string;
  laneId: string;
  hooksOnly: readonly unknown[];
}): void {
  const { ctx, resourceId, profile, laneId, hooksOnly } = options;

  for (const hookReference of hooksOnly) {
    const hookId =
      ctx.resolveReferenceId(hookReference) ??
      ctx.findIdByDefinition(hookReference);

    if (!ctx.registry.hooks.has(hookId)) {
      eventLaneHookPolicyHookReferenceInvalidError.throw({
        resourceId,
        profile,
        laneId,
        hookId,
      });
    }
  }
}

function forEachEventLanesProfileConsumeEntry(
  ctx: ValidatorContext,
  callback: (entry: {
    resourceId: string;
    profile: string;
    entry: EventLanesConsumeEntryLike;
  }) => void,
): void {
  for (const { resource, config } of ctx.registry.resources.values()) {
    const resourceId = ctx.findIdByDefinition(resource);
    if (!isEventLanesResourceId(resourceId)) {
      continue;
    }

    const profiles = (config as EventLanesConfigLike).topology?.profiles ?? {};

    for (const [profile, profileConfig] of Object.entries(profiles)) {
      const consume = profileConfig.consume ?? [];
      const seenLaneIds = new Set<string>();

      for (const entry of consume) {
        const laneId = entry.lane?.id ?? "unknown";
        if (seenLaneIds.has(laneId)) {
          eventLaneConsumeDuplicateLaneError.throw({
            resourceId,
            profile,
            laneId,
          });
        }
        seenLaneIds.add(laneId);
        callback({
          resourceId,
          profile,
          entry,
        });
      }
    }
  }
}

function isEventLanesResourceId(resourceId: string): boolean {
  return (
    resourceId === EVENT_LANES_RESOURCE_ID ||
    resourceId.endsWith(`.${EVENT_LANES_RESOURCE_ID}`)
  );
}
