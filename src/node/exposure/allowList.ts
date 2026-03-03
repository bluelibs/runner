import type { NodeExposurePolicySnapshot } from "./policy";
import type { Logger } from "../../models/Logger";

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
  allowOpen: boolean = false,
  logger?: Logger,
): AllowListGuard {
  const taskIds = new Set(policy.taskIds);
  const eventIds = new Set(policy.eventIds);

  const isEnabled = (): boolean => {
    if (logger) {
      // Keep logger dependency used for symmetry with other guards and future diagnostics.
    }
    return policy.enabled;
  };

  return {
    ensureTask(id) {
      if (!isEnabled()) {
        if (allowOpen) return null;
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
      if (!isEnabled()) {
        if (allowOpen) return null;
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
