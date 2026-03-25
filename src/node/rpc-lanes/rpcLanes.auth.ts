import type { IncomingMessage } from "http";
import type { IRpcLaneDefinition, RemoteLaneBindingAuth } from "../../defs";
import { jsonErrorResponse } from "../exposure/httpResponse";
import type { JsonResponse } from "../exposure/types";
import type { RpcLanesResourceConfig } from "./types";
import {
  assertRemoteLaneSignerConfigured,
  assertRemoteLaneVerifierConfigured,
  hashRemoteLanePayload,
  issueRemoteLaneToken,
  readRemoteLaneTokenFromHeaders,
  verifyRemoteLaneToken,
  writeRemoteLaneTokenToHeaders,
} from "../remote-lanes/laneAuth";
import type { RemoteLaneTokenTarget } from "../remote-lanes/laneAuth";

interface RpcLaneAuthResolvedState {
  mode: string;
  serveLaneIds: Set<string>;
  taskLaneByTaskId: Map<string, IRpcLaneDefinition>;
  eventLaneByEventId: Map<string, IRpcLaneDefinition>;
  bindingsByLaneId: Map<
    string,
    {
      lane: IRpcLaneDefinition;
      auth: RemoteLaneBindingAuth | undefined;
    }
  >;
}

export function getBindingAuthForRpcLane(
  config: RpcLanesResourceConfig,
  laneId: string,
): RemoteLaneBindingAuth | undefined {
  const binding = config.topology.bindings.find(
    (entry) => entry.lane.id === laneId,
  );
  return binding?.auth;
}

export function enforceRpcLaneAuthReadiness(
  config: RpcLanesResourceConfig,
  resolved: RpcLaneAuthResolvedState,
): void {
  const bindingAuthByLaneId = new Map(
    config.topology.bindings.map((binding) => [binding.lane.id, binding.auth]),
  );
  const laneById = new Map<string, IRpcLaneDefinition>();
  for (const lane of resolved.taskLaneByTaskId.values()) {
    laneById.set(lane.id, lane);
  }
  for (const lane of resolved.eventLaneByEventId.values()) {
    laneById.set(lane.id, lane);
  }

  const resolveAuthForLane = (
    laneId: string,
  ): RemoteLaneBindingAuth | undefined =>
    resolved.bindingsByLaneId.get(laneId)?.auth ??
    bindingAuthByLaneId.get(laneId);

  if (resolved.mode === "network") {
    for (const lane of laneById.values()) {
      const bindingAuth = resolveAuthForLane(lane.id);
      if (resolved.serveLaneIds.has(lane.id)) {
        assertRemoteLaneVerifierConfigured(lane.id, bindingAuth);
      } else {
        assertRemoteLaneSignerConfigured(lane.id, bindingAuth);
      }
    }
    return;
  }

  if (resolved.mode !== "local-simulated") {
    return;
  }
  for (const lane of laneById.values()) {
    const bindingAuth = resolveAuthForLane(lane.id);
    assertRemoteLaneSignerConfigured(lane.id, bindingAuth);
    assertRemoteLaneVerifierConfigured(lane.id, bindingAuth);
  }
}

export function buildRpcLaneAuthHeaders(options: {
  lane: IRpcLaneDefinition;
  bindingAuth: RemoteLaneBindingAuth | undefined;
  target: RemoteLaneTokenTarget;
}): Record<string, string> | undefined {
  const { lane, bindingAuth, target } = options;
  const token = issueRemoteLaneToken({
    laneId: lane.id,
    bindingAuth,
    capability: "produce",
    target,
  });
  if (!token) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  writeRemoteLaneTokenToHeaders(headers, bindingAuth, token);
  return headers;
}

export function authorizeRpcLaneRequest(
  req: IncomingMessage,
  lane: IRpcLaneDefinition,
  bindingAuth: RemoteLaneBindingAuth | undefined,
  target: Pick<RemoteLaneTokenTarget, "kind" | "targetId">,
  options?: {
    bodyText?: string;
  },
): JsonResponse | null {
  if (!bindingAuth || bindingAuth.mode === "none") {
    return null;
  }

  const token = readRemoteLaneTokenFromHeaders(req.headers, bindingAuth);
  if (!token) {
    return jsonErrorResponse(401, "Unauthorized", "UNAUTHORIZED");
  }

  try {
    verifyRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      token,
      requiredCapability: "produce",
      expectedTarget: {
        ...target,
        payloadHash: options?.bodyText
          ? hashRemoteLanePayload(options.bodyText)
          : undefined,
      },
    });
    return null;
  } catch {
    return jsonErrorResponse(401, "Unauthorized", "UNAUTHORIZED");
  }
}
