import type {
  IEventLaneDefinition,
  IEventLaneTopology,
  IRpcLaneDefinition,
  IRpcLanesTopology,
} from "../../defs";
import { remoteLanesTopologyConflictError } from "../../errors";

/**
 * Shared collector that deduplicates lanes found in both bindings and profiles.
 * Consumers choose which profile-level array to extract via `getProfileLanes`.
 */
function collectTopologyLanes<TLane extends { id: string }, TProfile>(
  topology: {
    bindings: readonly { lane: TLane }[];
    profiles: Record<string, TProfile>;
  },
  getProfileLanes: (profile: TProfile) => readonly TLane[],
): TLane[] {
  const lanes = new Map<string, TLane>();
  for (const binding of topology.bindings) {
    registerLane(lanes, binding.lane);
  }
  for (const profile of Object.values(topology.profiles)) {
    for (const lane of getProfileLanes(profile)) {
      registerLane(lanes, lane);
    }
  }
  return Array.from(lanes.values());
}

function registerLane<TLane extends { id: string }>(
  lanes: Map<string, TLane>,
  lane: TLane,
): void {
  const existing = lanes.get(lane.id);
  if (!existing) {
    lanes.set(lane.id, lane);
    return;
  }

  if (existing === lane) {
    return;
  }

  remoteLanesTopologyConflictError.throw({
    laneId: lane.id,
  });
}

export function collectEventTopologyLanes(
  topology: IEventLaneTopology,
): IEventLaneDefinition[] {
  return collectTopologyLanes(topology, (p) =>
    p.consume.map((entry) => entry.lane),
  );
}

export function collectRpcTopologyLanes(
  topology: IRpcLanesTopology,
): IRpcLaneDefinition[] {
  return collectTopologyLanes(topology, (p) => p.serve);
}
