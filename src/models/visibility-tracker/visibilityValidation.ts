import type { IsolationChannel } from "../../defs";
import type { StoreRegistry } from "../store/StoreRegistry";
import { getAccessViolation } from "./accessEvaluator";
import type { VisibilityTrackerState } from "./state";
import {
  collectDependencyEntries,
  collectMiddlewareVisibilityEntries,
  collectTagEntries,
} from "./visibilityValidationEntries";
import {
  getItemTypeLabel,
  resolveDependencyReferenceIds,
  resolveReferenceIds,
  resolveTagReferenceIds,
} from "./visibilityValidationReferences";
import { throwAccessViolation } from "./throwAccessViolation";

export function validateVisibility(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  validateItemDependencies(state, registry);
  validateHookEventVisibility(state, registry);
  validateTaggingVisibility(state, registry);
  validateMiddlewareVisibility(state, registry);
}

function validateItemDependencies(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  for (const entry of collectDependencyEntries(registry)) {
    validateReferenceIds(state, {
      consumerId: entry.consumerId,
      consumerType: entry.consumerType,
      channel: "dependencies",
      targetIds: resolveDependencyReferenceIds(registry, entry.dependencies),
      targetType: (targetId: string) => getItemTypeLabel(registry, targetId),
    });
  }
}

function validateHookEventVisibility(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  for (const { hook } of registry.hooks.values()) {
    if (!hook.on) {
      continue;
    }

    if (hook.on === "*") {
      const events = Array.from(registry.events.values()).map(
        (entry) => entry.event,
      );

      validateReferenceIds(state, {
        consumerId: hook.id,
        consumerType: "Hook",
        channel: "listening",
        targetIds: resolveReferenceIds(registry, events),
        targetType: "Event",
      });
      continue;
    }

    registry.resolveHookTargets(hook);
  }
}

function validateTaggingVisibility(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  for (const entry of collectTagEntries(registry)) {
    validateReferenceIds(state, {
      consumerId: entry.consumerId,
      consumerType: entry.consumerType,
      channel: "tagging",
      targetIds: resolveTagReferenceIds(registry, entry.tags),
      targetType: "Tag",
    });
  }
}

function validateMiddlewareVisibility(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  for (const entry of collectMiddlewareVisibilityEntries(registry)) {
    validateReferenceIds(state, {
      consumerId: entry.consumerId,
      consumerType: entry.consumerType,
      channel: "middleware",
      targetIds: entry.targetIds,
      targetType: entry.targetType,
    });
  }
}

function validateReferenceIds(
  state: VisibilityTrackerState,
  options: {
    consumerId: string;
    consumerType: string;
    channel: IsolationChannel;
    targetIds: Iterable<string>;
    targetType: string | ((targetId: string) => string);
  },
): void {
  const { consumerId, consumerType, channel, targetIds, targetType } = options;

  for (const targetId of targetIds) {
    const violation = getAccessViolation(state, targetId, consumerId, channel);
    if (!violation) {
      continue;
    }

    throwAccessViolation({
      violation,
      targetId,
      targetType:
        typeof targetType === "function" ? targetType(targetId) : targetType,
      consumerId,
      consumerType,
    });
  }
}
