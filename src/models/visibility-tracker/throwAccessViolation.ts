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

  if (violation.kind === "visibility") {
    return visibilityViolationError.throw({
      targetId,
      targetType,
      ownerResourceId: violation.targetOwnerResourceId,
      consumerId,
      consumerType,
      exportedIds: violation.exportedIds,
    });
  }

  return isolateViolationError.throw({
    targetId,
    targetType,
    consumerId,
    consumerType,
    policyResourceId: violation.policyResourceId,
    matchedRuleType: violation.matchedRuleType,
    matchedRuleId: violation.matchedRuleId,
    channel: violation.channel,
  });
}
