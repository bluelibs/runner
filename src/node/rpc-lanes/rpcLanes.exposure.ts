import { authorizeRpcLaneRequest } from "./rpcLanes.auth";
import { NodeExposure } from "../exposure/NodeExposure";
import { safeLogWarn } from "../exposure/logging";
import { hasServedEndpoints } from "../exposure/policy";
import type { NodeExposureDeps } from "../exposure/resourceTypes";
import { rpcLanesExposureModeError } from "../../errors";
import { toRpcLanesExposurePolicy } from "./RpcLanesInternals";
import type { RpcLanesRuntimeContext } from "./rpcLanes.runtime.utils";

export async function startRpcLanesExposure(
  context: RpcLanesRuntimeContext,
): Promise<{ close: () => Promise<void> } | null> {
  const { config, resolved, dependencies, resourceId } = context;
  if (!config.exposure?.http) {
    return null;
  }

  if (resolved.mode !== "network") {
    rpcLanesExposureModeError.throw({ mode: resolved.mode });
  }

  const policy = toRpcLanesExposurePolicy(resolved);
  if (!hasServedEndpoints(policy)) {
    safeLogWarn(dependencies.logger, "rpc-lanes.exposure.skipped", {
      profile: resolved.profile,
      mode: resolved.mode,
      reason: "no-served-task-or-event",
    });
    return null;
  }

  const exposure = new NodeExposure({
    http: config.exposure.http,
    deps: dependencies as NodeExposureDeps,
    policy,
    ownerResourceId: resourceId,
    authorization: {
      authorizeTask: async (req, taskId) => {
        const lane = resolved.taskLaneByTaskId.get(taskId);
        if (!lane || !resolved.serveLaneIds.has(lane.id)) {
          return null;
        }
        const binding = resolved.bindingsByLaneId.get(lane.id);
        return authorizeRpcLaneRequest(req, lane, binding?.auth);
      },
      authorizeEvent: async (req, eventId) => {
        const lane = resolved.eventLaneByEventId.get(eventId);
        if (!lane || !resolved.serveLaneIds.has(lane.id)) {
          return null;
        }
        const binding = resolved.bindingsByLaneId.get(lane.id);
        return authorizeRpcLaneRequest(req, lane, binding?.auth);
      },
    },
  });
  await exposure.start();
  return exposure;
}
