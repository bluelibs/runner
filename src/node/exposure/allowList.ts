import type { NodeExposurePolicySnapshot } from "./policy";

import { jsonErrorResponse } from "./httpResponse";
import type { AllowListGuard } from "./types";

enum AllowListErrorCode {
  Forbidden = "FORBIDDEN",
}

enum AllowListErrorMessage {
  ExposureNotEnabled = "Exposure not enabled",
}

export function createAllowListGuard(
  policy: NodeExposurePolicySnapshot,
): AllowListGuard {
  const taskIds = new Set(policy.taskIds);
  const eventIds = new Set(policy.eventIds);

  return {
    ensureTask(id) {
      if (!policy.enabled) {
        return jsonErrorResponse(
          403,
          AllowListErrorMessage.ExposureNotEnabled,
          AllowListErrorCode.Forbidden,
        );
      }
      if (!taskIds.has(id)) {
        return jsonErrorResponse(
          403,
          `Task ${id} not exposed`,
          AllowListErrorCode.Forbidden,
        );
      }
      return null;
    },
    ensureEvent(id) {
      if (!policy.enabled) {
        return jsonErrorResponse(
          403,
          AllowListErrorMessage.ExposureNotEnabled,
          AllowListErrorCode.Forbidden,
        );
      }
      if (!eventIds.has(id)) {
        return jsonErrorResponse(
          403,
          `Event ${id} not exposed`,
          AllowListErrorCode.Forbidden,
        );
      }
      return null;
    },
  };
}
