import type {
  IEventLaneDefinition,
  IEventLaneTopology,
  IRpcLaneDefinition,
  IRpcLanesTopology,
} from "../../defs";

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
    lanes.set(binding.lane.id, binding.lane);
  }
  for (const profile of Object.values(topology.profiles)) {
    for (const lane of getProfileLanes(profile)) {
      if (!lanes.has(lane.id)) {
        lanes.set(lane.id, lane);
      }
    }
  }
  return Array.from(lanes.values());
}

export function collectEventTopologyLanes(
  topology: IEventLaneTopology,
): IEventLaneDefinition[] {
  return collectTopologyLanes(topology, (p) => p.consume);
}

export function collectRpcTopologyLanes(
  topology: IRpcLanesTopology,
): IRpcLaneDefinition[] {
  return collectTopologyLanes(topology, (p) => p.serve);
}
