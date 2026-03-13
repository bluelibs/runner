import { authorizeRpcLaneRequest } from "./rpcLanes.auth";
import { safeLogWarn } from "../exposure/logging";
import { hasServedEndpoints } from "../exposure/policy";
import { createNodeExposure } from "../exposure/createNodeExposure";
import type {
  NodeExposureDeps,
  NodeExposureHandlers,
} from "../exposure/resourceTypes";
import { rpcLanesExposureModeError } from "../../errors";
import { toRpcLanesExposurePolicy } from "./RpcLanesInternals";
import type { RpcLanesRuntimeContext } from "./rpcLanes.runtime.utils";

export async function startRpcLanesExposure(
  context: RpcLanesRuntimeContext,
): Promise<{
  close: () => Promise<void>;
  getHandlers: () => NodeExposureHandlers;
} | null> {
  const { config, resolved, dependencies, resourceId } = context;
  if (!config.exposure?.http) {
    return null;
  }

  if (resolved.mode !== "network") {
    rpcLanesExposureModeError.throw({ mode: resolved.mode });
  }

  const policy = toRpcLanesExposurePolicy(resolved, (id) =>
    dependencies.store.toPublicId(id),
  );
  if (!hasServedEndpoints(policy)) {
    safeLogWarn(dependencies.logger, "rpc-lanes.exposure.skipped", {
      profile: resolved.profile,
      mode: resolved.mode,
      reason: "no-served-task-or-event",
    });
    return null;
  }

  const exposure = await createNodeExposure(
    { http: config.exposure.http },
    dependencies as NodeExposureDeps,
    {
      policy,
      sourceResourceId: resourceId,
      authorization: {
        authorizeTask: async (req, taskId) => {
          const canonicalTaskId =
            dependencies.store.resolveDefinitionId(taskId) ?? taskId;
          const lane = resolved.taskLaneByTaskId.get(canonicalTaskId);
          if (!lane || !resolved.serveLaneIds.has(lane.id)) {
            return null;
          }
          const binding = resolved.bindingsByLaneId.get(lane.id);
          return authorizeRpcLaneRequest(req, lane, binding?.auth);
        },
        authorizeEvent: async (req, eventId) => {
          const canonicalEventId =
            dependencies.store.resolveDefinitionId(eventId) ?? eventId;
          const lane = resolved.eventLaneByEventId.get(canonicalEventId);
          if (!lane || !resolved.serveLaneIds.has(lane.id)) {
            return null;
          }
          const binding = resolved.bindingsByLaneId.get(lane.id);
          return authorizeRpcLaneRequest(req, lane, binding?.auth);
        },
      },
    },
  );

  return {
    close: async () => {
      await exposure.close();
    },
    getHandlers: () => exposure,
  };
}
