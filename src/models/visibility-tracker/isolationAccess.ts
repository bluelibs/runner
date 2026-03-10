import type { IsolationChannel, IsolationSubtreeFilter } from "../../defs";
import type {
  AccessViolation,
  CompiledChannelSets,
  CompiledIsolationPolicy,
} from "./contracts";
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

    const whitelistedByGrant = isWhitelistedByPolicyGrant(
      state,
      policy,
      consumerId,
      targetId,
      channel,
    );
    const denySets = policy.deny[channel];
    const denyMatch = matchCompiledSets(state, targetId, denySets);
    if (denyMatch && !whitelistedByGrant) {
      return {
        kind: "isolate",
        policyResourceId,
        matchedRuleType: denyMatch.matchedRuleType,
        matchedRuleId: denyMatch.matchedRuleId,
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
    const onlyMatch = matchCompiledSets(state, targetId, onlySets, targetTags);

    if (!onlyMatch && !whitelistedByGrant) {
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

function isWhitelistedByPolicyGrant(
  state: VisibilityTrackerState,
  policy: CompiledIsolationPolicy,
  consumerId: string,
  targetId: string,
  channel: IsolationChannel,
): boolean {
  for (const grant of policy.whitelist) {
    if (
      !matchCompiledSets(state, consumerId, grant.consumers[channel]) ||
      !matchCompiledSets(state, targetId, grant.targets[channel])
    ) {
      continue;
    }

    return true;
  }

  return false;
}

function matchCompiledSets(
  state: VisibilityTrackerState,
  candidateId: string,
  compiledSets: CompiledChannelSets,
  candidateTags: ReadonlySet<string> | undefined = state.definitionTagIds.get(
    candidateId,
  ),
): {
  matchedRuleType: "id" | "tag" | "subtree" | "wildcard";
  matchedRuleId: string;
} | null {
  if (compiledSets.matchAll) {
    return {
      matchedRuleType: "wildcard",
      matchedRuleId: "*",
    };
  }

  if (compiledSets.ids.has(candidateId)) {
    return {
      matchedRuleType: "id",
      matchedRuleId: candidateId,
    };
  }

  if (compiledSets.tagIds.has(candidateId)) {
    return {
      matchedRuleType: "tag",
      matchedRuleId: candidateId,
    };
  }

  if (candidateTags) {
    for (const tagId of candidateTags) {
      if (!compiledSets.tagIds.has(tagId)) {
        continue;
      }

      return {
        matchedRuleType: "tag",
        matchedRuleId: tagId,
      };
    }
  }

  for (const filter of compiledSets.subtreeFilters) {
    if (!matchesSubtreeFilter(state, candidateId, filter)) {
      continue;
    }

    return {
      matchedRuleType: "subtree",
      matchedRuleId: filter.resourceId,
    };
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
