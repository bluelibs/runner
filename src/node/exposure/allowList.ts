import {
  computeRpcLaneAllowList,
  type RpcLaneAllowList,
} from "../rpc-lanes/allowList";
import type { Store } from "../../models/Store";
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
  store: Store,
  allowOpen: boolean = false,
  logger?: Logger,
): AllowListGuard {
  let cachedAllowList: RpcLaneAllowList | null = null;
  const allowList = (): RpcLaneAllowList => {
    if (cachedAllowList) return cachedAllowList;
    if (logger) {
      // Keep logger dependency used for symmetry with other guards and future diagnostics.
    }
    cachedAllowList = computeRpcLaneAllowList(store);
    return cachedAllowList;
  };

  return {
    ensureTask(id) {
      const list = allowList();
      if (!list.enabled) {
        if (allowOpen) return null;
        return jsonErrorResponse(
          403,
          AllowListErrorMessage.ExposureNotEnabled,
          AllowListErrorCode.Forbidden,
        );
      }
      if (!list.taskIds.has(id)) {
        return jsonErrorResponse(
          403,
          `Task ${id} not exposed`,
          AllowListErrorCode.Forbidden,
        );
      }
      return null;
    },
    ensureEvent(id) {
      const list = allowList();
      if (!list.enabled) {
        if (allowOpen) return null;
        return jsonErrorResponse(
          403,
          AllowListErrorMessage.ExposureNotEnabled,
          AllowListErrorCode.Forbidden,
        );
      }
      if (!list.eventIds.has(id)) {
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
