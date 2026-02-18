import {
  computeAllowList,
  type TunnelAllowList,
  type AllowListSelectorErrorInfo,
} from "../tunnel/allowlist";
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
  const reportSelectorError = ({
    selectorKind,
    candidateId,
    tunnelResourceId,
    error,
  }: AllowListSelectorErrorInfo) => {
    try {
      logger!.warn(
        "[runner] Tunnel allow-list selector failed; item skipped.",
        {
          error,
          data: { selectorKind, candidateId, tunnelResourceId },
        },
      );
    } catch {
      // Ignore logger failures and preserve allow-list behavior.
    }
  };

  const allowList = (): TunnelAllowList =>
    logger
      ? computeAllowList(store, reportSelectorError)
      : computeAllowList(store);

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
