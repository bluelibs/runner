import type { NodeExposureDeps } from "../exposure/resourceTypes";
import { rpcLaneOwnershipConflictError } from "../../errors";
import { symbolRpcLaneRoutedBy } from "../../types/symbols";
import type { RpcLaneResolvedState } from "./RpcLanesInternals";
import { applyLocalSimulatedModeRouting } from "./rpcLanes.local-simulated";
import { applyNetworkModeRouting } from "./rpcLanes.network";
import { startRpcLanesExposure } from "./rpcLanes.exposure";
import type { RpcLanesResourceConfig } from "./types";

export type RpcLanesDependencies = NodeExposureDeps & Record<string, unknown>;

export interface RpcLanesRuntimeContext {
  config: RpcLanesResourceConfig;
  resolved: RpcLaneResolvedState;
  dependencies: RpcLanesDependencies;
  resourceId: string;
}

export function applyRpcLanesModeRouting(
  context: RpcLanesRuntimeContext,
): void {
  const { resolved } = context;
  if (resolved.mode === "network") {
    applyNetworkModeRouting(context);
    return;
  }
  if (resolved.mode === "local-simulated") {
    applyLocalSimulatedModeRouting(context);
  }
}

export function assertTaskOwnership(
  taskId: string,
  task: { [symbolRpcLaneRoutedBy]?: string },
  resourceId: string,
): void {
  const currentOwner = task[symbolRpcLaneRoutedBy];
  if (currentOwner && currentOwner !== resourceId) {
    rpcLaneOwnershipConflictError.throw({
      taskId,
      currentOwnerId: currentOwner,
      attemptedOwnerId: resourceId,
    });
  }
}

export { startRpcLanesExposure };
