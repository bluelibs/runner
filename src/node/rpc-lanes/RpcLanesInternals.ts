import type { Store } from "../../models/Store";
import {
  createMessageError,
  rpcLaneBindingNotFoundError,
  rpcLaneCommunicatorResourceInvalidError,
  rpcLaneProfileNotFoundError,
} from "../../errors";
import type { IRpcLaneCommunicator, IRpcLaneDefinition } from "../../defs";
import type {
  RpcLanesResourceConfig,
  RpcLanesResourceValue,
  RpcLanesTopology,
} from "./types";
import {
  resolveRemoteLanesMode,
  type RemoteLanesMode,
} from "../remote-lanes/mode";
import { collectRpcTopologyLanes } from "../remote-lanes/topologyLanes";
import { resolveRpcLaneAssignments } from "./RpcLaneAssignments";

const RPC_LANE_COMMUNICATOR_DEPENDENCY_PREFIX = "__rpcLaneCommunicator__:";

export type RpcLaneResolvedBinding = {
  lane: IRpcLaneDefinition;
  communicator: IRpcLaneCommunicator;
  allowAsyncContext: boolean;
};

export interface RpcLaneResolvedState {
  profile: string;
  mode: RemoteLanesMode;
  serveLaneIds: Set<string>;
  bindingsByLaneId: Map<string, RpcLaneResolvedBinding>;
  taskLaneByTaskId: Map<string, IRpcLaneDefinition>;
  eventLaneByEventId: Map<string, IRpcLaneDefinition>;
  serveTaskIds: Set<string>;
  serveEventIds: Set<string>;
  taskAllowAsyncContext: Map<string, boolean>;
  eventAllowAsyncContext: Map<string, boolean>;
  communicatorByLaneId: Map<string, IRpcLaneCommunicator>;
}

export function collectRpcLaneCommunicatorResourceDependencies(
  config: RpcLanesResourceConfig,
): Record<string, any> {
  if (resolveRemoteLanesMode(config.mode) !== "network") {
    return {};
  }

  const deps: Record<string, any> = {};

  for (const binding of config.topology.bindings) {
    deps[toCommunicatorDependencyKey(binding.communicator.id)] =
      binding.communicator;
  }

  return deps;
}

export function resolveRpcLaneState(
  config: RpcLanesResourceConfig,
  dependencies: Record<string, unknown>,
  store: Store,
): RpcLaneResolvedState {
  const topologyLanes = collectRpcTopologyLanes(config.topology);
  const assignments = resolveRpcLaneAssignments(store, topologyLanes);
  const mode = resolveRemoteLanesMode(config.mode);
  const profile =
    mode === "network"
      ? resolveProfile(config.topology, String(config.profile))
      : ({ serve: [] } as const);
  const serveLaneIds = new Set(profile.serve.map((lane) => lane.id));
  const bindingsByLaneId =
    mode === "network" ? resolveBindings(config, dependencies) : new Map();
  const communicatorByLaneId = new Map<string, IRpcLaneCommunicator>();
  for (const [laneId, binding] of bindingsByLaneId.entries()) {
    communicatorByLaneId.set(laneId, binding.communicator);
  }

  if (mode === "network") {
    for (const laneId of serveLaneIds) {
      if (!bindingsByLaneId.has(laneId)) {
        rpcLaneBindingNotFoundError.throw({ laneId });
      }
    }

    const taggedLaneIds = new Set<string>();
    for (const lane of assignments.taskLaneByTaskId.values()) {
      taggedLaneIds.add(lane.id);
    }
    for (const lane of assignments.eventLaneByEventId.values()) {
      taggedLaneIds.add(lane.id);
    }
    for (const laneId of taggedLaneIds) {
      if (!bindingsByLaneId.has(laneId)) {
        rpcLaneBindingNotFoundError.throw({ laneId });
      }
    }
  }

  const serveTaskIds = new Set<string>();
  const serveEventIds = new Set<string>();
  const taskAllowAsyncContext = new Map<string, boolean>();
  const eventAllowAsyncContext = new Map<string, boolean>();
  if (mode === "network") {
    for (const [taskId, lane] of assignments.taskLaneByTaskId.entries()) {
      if (!serveLaneIds.has(lane.id)) {
        continue;
      }
      const binding = bindingsByLaneId.get(lane.id)!;
      serveTaskIds.add(taskId);
      taskAllowAsyncContext.set(taskId, binding.allowAsyncContext);
    }

    for (const [eventId, lane] of assignments.eventLaneByEventId.entries()) {
      if (!serveLaneIds.has(lane.id)) {
        continue;
      }
      const binding = bindingsByLaneId.get(lane.id)!;
      serveEventIds.add(eventId);
      eventAllowAsyncContext.set(eventId, binding.allowAsyncContext);
    }
  }

  return {
    profile: String(config.profile),
    mode,
    serveLaneIds,
    bindingsByLaneId,
    taskLaneByTaskId: assignments.taskLaneByTaskId,
    eventLaneByEventId: assignments.eventLaneByEventId,
    serveTaskIds,
    serveEventIds,
    taskAllowAsyncContext,
    eventAllowAsyncContext,
    communicatorByLaneId,
  };
}

export function toRpcLanesResourceValue(
  resolved: RpcLaneResolvedState,
  exposure?: { close: () => Promise<void> } | null,
): RpcLanesResourceValue {
  return {
    profile: resolved.profile,
    mode: resolved.mode,
    serveTaskIds: Array.from(resolved.serveTaskIds),
    serveEventIds: Array.from(resolved.serveEventIds),
    taskAllowAsyncContext: Object.freeze(
      Array.from(resolved.taskAllowAsyncContext.entries()).reduce<
        Record<string, boolean>
      >((acc, [taskId, allow]) => {
        acc[taskId] = allow;
        return acc;
      }, {}),
    ),
    eventAllowAsyncContext: Object.freeze(
      Array.from(resolved.eventAllowAsyncContext.entries()).reduce<
        Record<string, boolean>
      >((acc, [eventId, allow]) => {
        acc[eventId] = allow;
        return acc;
      }, {}),
    ),
    communicatorByLaneId: resolved.communicatorByLaneId,
    exposure: exposure ?? null,
  };
}

function toCommunicatorDependencyKey(communicatorResourceId: string): string {
  return `${RPC_LANE_COMMUNICATOR_DEPENDENCY_PREFIX}${communicatorResourceId}`;
}

function resolveProfile(topology: RpcLanesTopology, profileId: string) {
  const profile = topology.profiles[profileId];
  if (!profile) {
    rpcLaneProfileNotFoundError.throw({ profile: profileId });
  }
  return profile!;
}

function resolveBindings(
  config: RpcLanesResourceConfig,
  dependencies: Record<string, unknown>,
): Map<string, RpcLaneResolvedBinding> {
  const map = new Map<string, RpcLaneResolvedBinding>();
  const seenLaneIds = new Set<string>();

  for (const binding of config.topology.bindings) {
    if (seenLaneIds.has(binding.lane.id)) {
      createMessageError(
        `rpcLane "${binding.lane.id}" is bound multiple times. Define exactly one communicator binding per lane.`,
      );
    }
    seenLaneIds.add(binding.lane.id);

    const dependencyKey = toCommunicatorDependencyKey(binding.communicator.id);
    const communicator = dependencies[dependencyKey];
    if (
      !communicator ||
      typeof communicator !== "object" ||
      (typeof (communicator as IRpcLaneCommunicator).task !== "function" &&
        typeof (communicator as IRpcLaneCommunicator).event !== "function" &&
        typeof (communicator as IRpcLaneCommunicator).eventWithResult !==
          "function")
    ) {
      rpcLaneCommunicatorResourceInvalidError.throw({
        resourceId: binding.communicator.id,
      });
    }

    map.set(binding.lane.id, {
      lane: binding.lane,
      communicator: communicator as IRpcLaneCommunicator,
      allowAsyncContext: binding.allowAsyncContext !== false,
    });
  }

  return map;
}
