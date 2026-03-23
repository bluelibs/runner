import type { Store } from "../../models/Store";
import {
  rpcLaneDuplicateBindingError,
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
import { resolveLaneAsyncContextPolicy } from "../remote-lanes/asyncContextAllowlist";
import type { NodeExposurePolicySnapshot } from "../exposure/policy";
import { collectRemoteLaneResourceDependencies } from "../remote-lanes/resourceDependencies";
import {
  createRemoteLaneReplayProtector,
  type RemoteLaneReplayProtector,
} from "../remote-lanes/laneAuth";

const RPC_LANE_COMMUNICATOR_DEPENDENCY_PREFIX = "__rpcLaneCommunicator__:";

export type RpcLaneResolvedBinding = {
  lane: IRpcLaneDefinition;
  communicator: IRpcLaneCommunicator;
  allowAsyncContext: boolean;
  asyncContextAllowList: readonly string[] | undefined;
  auth: RpcLanesTopology["bindings"][number]["auth"];
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
  taskAsyncContextAllowList: Map<string, readonly string[] | undefined>;
  eventAsyncContextAllowList: Map<string, readonly string[] | undefined>;
  communicatorByLaneId: Map<string, IRpcLaneCommunicator>;
  replayProtector: RemoteLaneReplayProtector;
}

interface RpcLanesExposureSnapshot {
  taskIds: readonly string[];
  eventIds: readonly string[];
  taskAllowAsyncContext: Readonly<Record<string, boolean>>;
  eventAllowAsyncContext: Readonly<Record<string, boolean>>;
  taskAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
  eventAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
}

function toFrozenRecord<TValue>(
  entries: Iterable<readonly [string, TValue]>,
  mapId: (id: string) => string,
): Readonly<Record<string, Exclude<TValue, undefined>>> {
  const record: Record<string, Exclude<TValue, undefined>> = {};

  for (const [id, value] of entries) {
    if (value !== undefined) {
      record[mapId(id)] = value as Exclude<TValue, undefined>;
    }
  }

  return Object.freeze(record);
}

export function collectRpcLaneCommunicatorResourceDependencies(
  config: RpcLanesResourceConfig,
): Record<string, any> {
  return collectRemoteLaneResourceDependencies({
    mode: config.mode,
    bindings: config.topology.bindings,
    getResource: (binding) => binding.communicator,
    toDependencyKey: toCommunicatorDependencyKey,
  });
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
  const taskAsyncContextAllowList = new Map<
    string,
    readonly string[] | undefined
  >();
  const eventAsyncContextAllowList = new Map<
    string,
    readonly string[] | undefined
  >();
  if (mode === "network") {
    for (const [taskId, lane] of assignments.taskLaneByTaskId.entries()) {
      if (!serveLaneIds.has(lane.id)) {
        continue;
      }
      const binding = bindingsByLaneId.get(lane.id)!;
      serveTaskIds.add(taskId);
      taskAllowAsyncContext.set(taskId, binding.allowAsyncContext);
      taskAsyncContextAllowList.set(taskId, binding.asyncContextAllowList);
    }

    for (const [eventId, lane] of assignments.eventLaneByEventId.entries()) {
      if (!serveLaneIds.has(lane.id)) {
        continue;
      }
      const binding = bindingsByLaneId.get(lane.id)!;
      serveEventIds.add(eventId);
      eventAllowAsyncContext.set(eventId, binding.allowAsyncContext);
      eventAsyncContextAllowList.set(eventId, binding.asyncContextAllowList);
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
    taskAsyncContextAllowList,
    eventAsyncContextAllowList,
    communicatorByLaneId,
    replayProtector: createRemoteLaneReplayProtector(),
  };
}

export function toRpcLanesResourceValue(
  resolved: RpcLaneResolvedState,
  exposure?: { close: () => Promise<void> } | null,
  mapId: (id: string) => string = (id) => id,
): RpcLanesResourceValue {
  const snapshot = toRpcLanesExposureSnapshot(resolved, mapId);

  return {
    profile: resolved.profile,
    mode: resolved.mode,
    serveTaskIds: snapshot.taskIds,
    serveEventIds: snapshot.eventIds,
    taskAllowAsyncContext: snapshot.taskAllowAsyncContext,
    eventAllowAsyncContext: snapshot.eventAllowAsyncContext,
    taskAsyncContextAllowList: snapshot.taskAsyncContextAllowList,
    eventAsyncContextAllowList: snapshot.eventAsyncContextAllowList,
    communicatorByLaneId: resolved.communicatorByLaneId,
    exposure: exposure ?? null,
  };
}

export function toRpcLanesExposurePolicy(
  resolved: RpcLaneResolvedState,
  mapId: (id: string) => string = (id) => id,
): NodeExposurePolicySnapshot {
  const snapshot = toRpcLanesExposureSnapshot(resolved, mapId);

  return {
    enabled: snapshot.taskIds.length > 0 || snapshot.eventIds.length > 0,
    taskIds: snapshot.taskIds,
    eventIds: snapshot.eventIds,
    taskAllowAsyncContext: snapshot.taskAllowAsyncContext,
    eventAllowAsyncContext: snapshot.eventAllowAsyncContext,
    taskAsyncContextAllowList: snapshot.taskAsyncContextAllowList,
    eventAsyncContextAllowList: snapshot.eventAsyncContextAllowList,
  };
}

function toRpcLanesExposureSnapshot(
  resolved: RpcLaneResolvedState,
  mapId: (id: string) => string,
): RpcLanesExposureSnapshot {
  return {
    taskIds: Object.freeze(Array.from(resolved.serveTaskIds, mapId)),
    eventIds: Object.freeze(Array.from(resolved.serveEventIds, mapId)),
    taskAllowAsyncContext: toFrozenRecord(
      resolved.taskAllowAsyncContext.entries(),
      mapId,
    ),
    eventAllowAsyncContext: toFrozenRecord(
      resolved.eventAllowAsyncContext.entries(),
      mapId,
    ),
    taskAsyncContextAllowList: toFrozenRecord(
      resolved.taskAsyncContextAllowList.entries(),
      mapId,
    ),
    eventAsyncContextAllowList: toFrozenRecord(
      resolved.eventAsyncContextAllowList.entries(),
      mapId,
    ),
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
  return profile;
}

function resolveBindings(
  config: RpcLanesResourceConfig,
  dependencies: Record<string, unknown>,
): Map<string, RpcLaneResolvedBinding> {
  const map = new Map<string, RpcLaneResolvedBinding>();
  const seenLaneIds = new Set<string>();

  for (const binding of config.topology.bindings) {
    if (seenLaneIds.has(binding.lane.id)) {
      rpcLaneDuplicateBindingError.throw({ laneId: binding.lane.id });
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

    const asyncContextPolicy = resolveLaneAsyncContextPolicy({
      laneAsyncContexts: binding.lane.asyncContexts,
      legacyAllowAsyncContext: binding.allowAsyncContext,
    });

    map.set(binding.lane.id, {
      lane: binding.lane,
      communicator: communicator as IRpcLaneCommunicator,
      allowAsyncContext: asyncContextPolicy.allowAsyncContext,
      asyncContextAllowList: asyncContextPolicy.allowList,
      auth: binding.auth,
    });
  }

  return map;
}
