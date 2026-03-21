import type { IEventLaneDefinition, RemoteLaneBindingAuth } from "../../defs";
import { remoteLaneAuthUnauthorizedError } from "../../errors";
import {
  assertRemoteLaneSignerConfigured,
  assertRemoteLaneVerifierConfigured,
  verifyRemoteLaneToken,
} from "../remote-lanes/laneAuth";
import { resolveLaneAuthPolicy } from "../remote-lanes/laneAuth.policy";
import type { EventLaneMessage, EventLanesResourceConfig } from "./types";
import type { EventLanesResourceContext } from "./EventLanesInternals";

export function collectBindingAuthByLaneId(
  config: EventLanesResourceConfig,
): ReadonlyMap<string, RemoteLaneBindingAuth | undefined> {
  const map = new Map<string, RemoteLaneBindingAuth | undefined>();
  for (const binding of config.topology.bindings) {
    map.set(binding.lane.id, binding.auth);
  }
  return map;
}

export function resolveEventLaneBindingAuth(options: {
  laneId: string;
  context: EventLanesResourceContext;
  config: EventLanesResourceConfig;
}): RemoteLaneBindingAuth | undefined {
  const { laneId, context, config } = options;
  const resolvedBinding = context.bindingsByLaneId.get(laneId);
  if (resolvedBinding) {
    return resolvedBinding.auth;
  }
  return config.topology.bindings.find((entry) => entry.lane.id === laneId)
    ?.auth;
}

export function enforceEventLaneAuthReadiness(options: {
  mode: "network" | "transparent" | "local-simulated";
  context: EventLanesResourceContext;
  config: EventLanesResourceConfig;
}): void {
  const { mode, context, config } = options;
  const laneById = collectAuthRelevantEventLanes(context);

  for (const laneId of laneById.keys()) {
    const bindingAuth = resolveEventLaneBindingAuth({
      laneId,
      context,
      config,
    });

    if (mode === "network") {
      const isConsumed = Array.from(
        context.activeBindingsByQueue.values(),
      ).some((laneIds) => laneIds.has(laneId));
      if (isConsumed) {
        assertRemoteLaneVerifierConfigured(laneId, bindingAuth);
      } else {
        assertRemoteLaneSignerConfigured(laneId, bindingAuth);
      }
      continue;
    }

    if (mode === "local-simulated") {
      assertRemoteLaneSignerConfigured(laneId, bindingAuth);
      assertRemoteLaneVerifierConfigured(laneId, bindingAuth);
    }
  }
}

function collectAuthRelevantEventLanes(
  context: EventLanesResourceContext,
): Map<string, IEventLaneDefinition> {
  const laneById = new Map<string, IEventLaneDefinition>();

  for (const route of context.eventRouteByEventId.values()) {
    laneById.set(route.lane.id, route.lane);
  }

  for (const laneIds of context.activeBindingsByQueue.values()) {
    for (const laneId of laneIds) {
      const lane = context.bindingsByLaneId.get(laneId)?.lane;
      if (lane) {
        laneById.set(laneId, lane);
      }
    }
  }

  return laneById;
}

export function verifyEventLaneMessageToken(options: {
  message: EventLaneMessage;
  laneId: string;
  bindingAuth: RemoteLaneBindingAuth | undefined;
}): void {
  const { message, laneId, bindingAuth } = options;
  if (resolveLaneAuthPolicy(bindingAuth).mode === "none") {
    return;
  }
  const authToken = message.authToken;
  if (!authToken) {
    throw remoteLaneAuthUnauthorizedError.new({
      laneId,
      reason: "missing lane auth token",
    });
  }

  verifyRemoteLaneToken({
    laneId,
    bindingAuth,
    token: authToken,
    requiredCapability: "produce",
  });
}
