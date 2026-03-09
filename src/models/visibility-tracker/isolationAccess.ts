import type { IsolationChannel, IsolationSubtreeFilter } from "../../defs";
import type { AccessViolation } from "./contracts";
import type { VisibilityTrackerState } from "./state";

export function findIsolationViolation(
  state: VisibilityTrackerState,
  targetId: string,
  consumerId: string,
  channel: IsolationChannel,
): Extract<AccessViolation, { kind: "isolate" }> | null {
  const chain = getConsumerResourceChain(state, consumerId);
  if (chain.length === 0) {
    return null;
  }

  const targetTags = state.definitionTagIds.get(targetId);

  for (const policyResourceId of chain) {
    const policy = state.isolationPolicies.get(policyResourceId);
    if (!policy) {
      continue;
    }

    const denySets = policy.deny[channel];
    if (denySets.ids.has(targetId)) {
      return {
        kind: "isolate",
        policyResourceId,
        matchedRuleType: "id",
        matchedRuleId: targetId,
        channel,
      };
    }

    if (denySets.tagIds.has(targetId)) {
      return {
        kind: "isolate",
        policyResourceId,
        matchedRuleType: "tag",
        matchedRuleId: targetId,
        channel,
      };
    }

    if (targetTags) {
      for (const tagId of targetTags) {
        if (!denySets.tagIds.has(tagId)) {
          continue;
        }

        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "tag",
          matchedRuleId: tagId,
          channel,
        };
      }
    }

    for (const filter of denySets.subtreeFilters) {
      if (!matchesSubtreeFilter(state, targetId, filter)) {
        continue;
      }

      return {
        kind: "isolate",
        policyResourceId,
        matchedRuleType: "subtree",
        matchedRuleId: filter.resourceId,
        channel,
      };
    }

    if (!policy.onlyMode) {
      continue;
    }

    const policySubtree = state.subtrees.get(policyResourceId);
    const isInternal =
      targetId === policyResourceId || policySubtree?.has(targetId) === true;

    if (isInternal) {
      continue;
    }

    const onlySets = policy.only[channel];
    const matchedByOnlyId = onlySets.ids.has(targetId);
    const matchedByOnlyTag =
      onlySets.tagIds.has(targetId) ||
      (targetTags !== undefined &&
        [...targetTags].some((tagId) => onlySets.tagIds.has(tagId)));
    const matchedByOnlySubtree = onlySets.subtreeFilters.some((filter) =>
      matchesSubtreeFilter(state, targetId, filter),
    );

    if (!matchedByOnlyId && !matchedByOnlyTag && !matchedByOnlySubtree) {
      return {
        kind: "isolate",
        policyResourceId,
        matchedRuleType: "only",
        matchedRuleId: targetId,
        channel,
      };
    }
  }

  return null;
}

function matchesSubtreeFilter(
  state: VisibilityTrackerState,
  targetId: string,
  filter: IsolationSubtreeFilter,
): boolean {
  const filterSubtree = state.subtrees.get(filter.resourceId);
  const inFilterSubtree =
    targetId === filter.resourceId || filterSubtree?.has(targetId);
  if (!inFilterSubtree) {
    return false;
  }

  if (filter.types && filter.types.length > 0) {
    const targetType = state.itemTypes.get(targetId);
    if (!targetType || !filter.types.includes(targetType)) {
      return false;
    }
  }

  return true;
}

function getConsumerResourceChain(
  state: VisibilityTrackerState,
  consumerId: string,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();

  let current: string | undefined = state.knownResources.has(consumerId)
    ? consumerId
    : state.ownership.get(consumerId);

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = state.ownership.get(current);
  }

  return chain;
}
