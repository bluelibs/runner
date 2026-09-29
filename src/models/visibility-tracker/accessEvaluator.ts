import type { IsolationChannel } from "../../defs";
import type { AccessViolation } from "./contracts";
import type { VisibilityTrackerState } from "./state";
import { findIsolationViolation } from "./isolationAccess";
import { findVisibilityViolation } from "./visibilityAccess";

export { getRootAccessInfo } from "./visibilityAccess";
export { hasExportsDeclaration } from "./visibilityAccess";

export function isAccessible(
  state: VisibilityTrackerState,
  targetId: string,
  consumerId: string,
  channel: IsolationChannel,
): boolean {
  return getAccessViolation(state, targetId, consumerId, channel) === null;
}

export function getAccessViolation(
  state: VisibilityTrackerState,
  targetId: string,
  consumerId: string,
  channel: IsolationChannel,
): AccessViolation | null {
  const scopedResources = state.scopedResources;
  if (scopedResources) {
    // Scope compilation changes storage identities, not the user's isolation selectors.
    targetId = scopedResources.get(targetId)?.targetId ?? targetId;
    consumerId = scopedResources.get(consumerId)?.consumerId ?? consumerId;
  }
  return (
    findVisibilityViolation(state, targetId, consumerId) ??
    findIsolationViolation(state, targetId, consumerId, channel)
  );
}
