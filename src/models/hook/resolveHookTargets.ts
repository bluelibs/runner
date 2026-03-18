import type {
  HookOnPredicate,
  IEvent,
  IsolationSubtreeFilter,
  OnType,
} from "../../defs";
import { isSubtreeFilter } from "../../definers/tools";
import {
  eventNotFoundError,
  resourceNotFoundError,
  validationError,
} from "../../errors";
import type { AccessViolation } from "../visibility-tracker/contracts";
import { throwAccessViolation } from "../visibility-tracker/throwAccessViolation";
import {
  getSubtreeFilterResourceReference,
  isSubtreeFilterItemType,
} from "../../tools/subtreeOf";

/**
 * Concrete event selected from a hook's `on` declaration.
 *
 * `provenance` is useful for tooling/tests that need to distinguish exact
 * matches from selector-derived matches after bootstrap resolution.
 */
export type HookTargetResolutionEntry = {
  event: IEvent<unknown>;
  provenance: "exact" | "selector";
};

export type HookTargetResolutionContext = {
  resolveDefinitionId(reference: unknown): string | null | undefined;
  getEventById(id: string): IEvent<unknown> | undefined;
  getRegisteredEvents(): Iterable<IEvent<unknown>>;
  getResourceById(id: string): unknown;
  isWithinResourceSubtree(resourceId: string, itemId: string): boolean;
  getAccessViolation(
    targetId: string,
    consumerId: string,
    channel: "listening",
  ): AccessViolation | null;
};

function toEntryList(
  on: Exclude<OnType, "*">,
  hookId: string,
): readonly unknown[] {
  if (!Array.isArray(on)) {
    return [on];
  }

  if (on.some((entry) => entry === "*")) {
    validationError.throw({
      subject: "Hook on",
      id: hookId,
      originalError: 'Wildcard "*" must be used as a standalone hook target.',
    });
  }

  return on;
}

function assertValidHookSubtreeFilter(
  filter: { types?: ReadonlyArray<unknown> },
  hookId: string,
): void {
  const filterTypes = filter.types;
  if (filterTypes === undefined) {
    return;
  }

  const isValid =
    Array.isArray(filterTypes) &&
    filterTypes.length === 1 &&
    isSubtreeFilterItemType(filterTypes[0]) &&
    filterTypes[0] === "event";

  if (isValid) {
    return;
  }

  validationError.throw({
    subject: "Hook on",
    id: hookId,
    originalError:
      'subtreeOf() used in hook.on() must omit { types } or use only { types: ["event"] }.',
  });
}

function throwIfInaccessible(
  context: HookTargetResolutionContext,
  hookId: string,
  eventId: string,
): void {
  const violation = context.getAccessViolation(eventId, hookId, "listening");
  if (!violation) {
    return;
  }

  throwAccessViolation({
    violation,
    targetId: eventId,
    targetType: "Event",
    consumerId: hookId,
    consumerType: "Hook",
  });
}

function toUnresolvedTargetId(target: unknown): string {
  if (typeof target === "string") {
    return target;
  }

  if (
    typeof target === "object" &&
    target !== null &&
    "id" in target &&
    typeof (target as { id?: unknown }).id === "string"
  ) {
    return (target as { id: string }).id;
  }

  return String(target);
}

function resolveExactEvent(
  context: HookTargetResolutionContext,
  hookId: string,
  target: unknown,
): HookTargetResolutionEntry {
  const resolvedEventId = context.resolveDefinitionId(target);

  if (!resolvedEventId) {
    throw eventNotFoundError.new({ id: toUnresolvedTargetId(target) });
  }

  const eventId = resolvedEventId;
  const event = context.getEventById(eventId);
  if (!event) {
    throw eventNotFoundError.new({ id: eventId });
  }

  throwIfInaccessible(context, hookId, event.id);

  return { event, provenance: "exact" };
}

function resolveSubtreeEvents(
  context: HookTargetResolutionContext,
  hookId: string,
  target: IsolationSubtreeFilter,
): HookTargetResolutionEntry[] {
  assertValidHookSubtreeFilter(target, hookId);
  const filter = target;
  const resourceReference = getSubtreeFilterResourceReference(filter);
  const resolvedResourceId =
    (resourceReference
      ? context.resolveDefinitionId(resourceReference)
      : undefined) ??
    context.resolveDefinitionId(filter.resourceId) ??
    filter.resourceId;

  if (!context.getResourceById(resolvedResourceId)) {
    resourceNotFoundError.throw({ id: resolvedResourceId });
  }

  const resolvedTargets: HookTargetResolutionEntry[] = [];
  for (const event of context.getRegisteredEvents()) {
    if (!context.isWithinResourceSubtree(resolvedResourceId, event.id)) {
      continue;
    }
    if (context.getAccessViolation(event.id, hookId, "listening")) {
      continue;
    }

    resolvedTargets.push({ event, provenance: "selector" });
  }

  return resolvedTargets;
}

function resolvePredicateEvents(
  context: HookTargetResolutionContext,
  hookId: string,
  predicate: HookOnPredicate,
): HookTargetResolutionEntry[] {
  const resolvedTargets: HookTargetResolutionEntry[] = [];

  for (const event of context.getRegisteredEvents()) {
    if (context.getAccessViolation(event.id, hookId, "listening")) {
      continue;
    }
    if (!predicate(event)) {
      continue;
    }

    resolvedTargets.push({ event, provenance: "selector" });
  }

  return resolvedTargets;
}

/**
 * Resolves a hook's `on` declaration into the concrete registered events it
 * will subscribe to.
 *
 * Exact refs remain fail-fast. Selector-derived matches are resolved once at
 * bootstrap and silently skip events the hook cannot listen to.
 */
export function resolveHookTargets(options: {
  context: HookTargetResolutionContext;
  hookId: string;
  on: Exclude<OnType, "*">;
}): HookTargetResolutionEntry[] {
  const { context, hookId, on } = options;
  const resolvedTargets: HookTargetResolutionEntry[] = [];
  const seenEventIds = new Set<string>();

  for (const entry of toEntryList(on, hookId)) {
    const matches = isSubtreeFilter(entry)
      ? resolveSubtreeEvents(context, hookId, entry)
      : typeof entry === "function"
        ? resolvePredicateEvents(context, hookId, entry as HookOnPredicate)
        : [resolveExactEvent(context, hookId, entry)];

    for (const match of matches) {
      if (seenEventIds.has(match.event.id)) {
        continue;
      }

      seenEventIds.add(match.event.id);
      resolvedTargets.push(match);
    }
  }

  return resolvedTargets;
}
