import type { IsolationChannel } from "../../defs";
import { isolateViolationError, visibilityViolationError } from "../../errors";
import type { StoreRegistry } from "../StoreRegistry";
import { getAccessViolation } from "./accessEvaluator";
import type { AccessViolation } from "./contracts";
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
    validateReferenceIds(state, registry, {
      consumerId: entry.consumerId,
      consumerType: entry.consumerType,
      channel: "dependencies",
      targetIds: resolveDependencyReferenceIds(registry, entry.dependencies),
      targetType: (targetId) => getItemTypeLabel(registry, targetId),
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

    const events =
      hook.on === "*"
        ? Array.from(registry.events.values()).map((entry) => entry.event)
        : Array.isArray(hook.on)
          ? hook.on
          : [hook.on];

    validateReferenceIds(state, registry, {
      consumerId: hook.id,
      consumerType: "Hook",
      channel: "listening",
      targetIds: resolveReferenceIds(registry, events),
      targetType: "Event",
    });
  }
}

function validateTaggingVisibility(
  state: VisibilityTrackerState,
  registry: StoreRegistry,
): void {
  for (const entry of collectTagEntries(registry)) {
    validateReferenceIds(state, registry, {
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
    validateReferenceIds(state, registry, {
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
  registry: StoreRegistry,
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

    throwAccessViolation(registry, {
      violation,
      targetId,
      targetType:
        typeof targetType === "function" ? targetType(targetId) : targetType,
      consumerId,
      consumerType,
    });
  }
}

function throwAccessViolation(
  registry: StoreRegistry,
  data: {
    violation: AccessViolation;
    targetId: string;
    targetType: string;
    consumerId: string;
    consumerType: string;
  },
): void {
  const { violation, targetId, targetType, consumerId, consumerType } = data;
  const toDisplayId = (id: string): string => registry.getDisplayId(id);
  const displayTargetId = toDisplayId(targetId);
  const displayConsumerId = toDisplayId(consumerId);

  if (violation.kind === "visibility") {
    visibilityViolationError.throw({
      targetId: displayTargetId,
      targetType,
      ownerResourceId: toDisplayId(violation.targetOwnerResourceId),
      consumerId: displayConsumerId,
      consumerType,
      exportedIds: violation.exportedIds.map(toDisplayId),
    });
  } else {
    isolateViolationError.throw({
      targetId: displayTargetId,
      targetType,
      consumerId: displayConsumerId,
      consumerType,
      policyResourceId: toDisplayId(violation.policyResourceId),
      matchedRuleType: violation.matchedRuleType,
      matchedRuleId: toDisplayId(violation.matchedRuleId),
      channel: violation.channel,
    });
  }
}
