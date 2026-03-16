import { isolateViolationError, visibilityViolationError } from "../../errors";
import type { AccessViolation } from "./contracts";

/**
 * Re-throws a normalized access violation using the appropriate public Runner
 * error helper so callers do not need to duplicate formatting branches.
 */
export function throwAccessViolation(data: {
  violation: AccessViolation;
  targetId: string;
  targetType: string;
  consumerId: string;
  consumerType: string;
}): never {
  const { violation, targetId, targetType, consumerId, consumerType } = data;
  const toDisplayId = (id: string): string => id;
  const displayTargetId = toDisplayId(targetId);
  const displayConsumerId = toDisplayId(consumerId);

  if (violation.kind === "visibility") {
    return visibilityViolationError.throw({
      targetId: displayTargetId,
      targetType,
      ownerResourceId: toDisplayId(violation.targetOwnerResourceId),
      consumerId: displayConsumerId,
      consumerType,
      exportedIds: violation.exportedIds.map(toDisplayId),
    });
  }

  return isolateViolationError.throw({
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
