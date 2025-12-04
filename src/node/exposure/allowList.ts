import { computeAllowList } from "../tunnel.allowlist";
import type { TunnelAllowList } from "../tunnel.allowlist";
import type { Store } from "../../models/Store";

import { jsonErrorResponse } from "./httpResponse";
import type { AllowListGuard } from "./types";

export function createAllowListGuard(store: Store): AllowListGuard {
  let cache: TunnelAllowList | null = null;

  const allowList = () => {
    if (!cache) {
      cache = computeAllowList(store);
    }
    return cache;
  };

  return {
    ensureTask(id) {
      const list = allowList();
      if (!list.enabled) {
        return null;
      }
      if (!list.taskIds.has(id)) {
        return jsonErrorResponse(403, `Task ${id} not exposed`, "FORBIDDEN");
      }
      return null;
    },
    ensureEvent(id) {
      const list = allowList();
      if (!list.enabled) {
        return null;
      }
      if (!list.eventIds.has(id)) {
        return jsonErrorResponse(403, `Event ${id} not exposed`, "FORBIDDEN");
      }
      return null;
    },
  };
}
