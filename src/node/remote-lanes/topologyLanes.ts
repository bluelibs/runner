import type {
  IEventLaneDefinition,
  IEventLaneTopology,
  IRpcLaneDefinition,
  IRpcLanesTopology,
} from "../../defs";

export function collectEventTopologyLanes(
  topology: IEventLaneTopology,
): IEventLaneDefinition[] {
  const lanes = new Map<string, IEventLaneDefinition>();
  for (const binding of topology.bindings) {
    lanes.set(binding.lane.id, binding.lane);
  }
  for (const profile of Object.values(topology.profiles)) {
    for (const lane of profile.consume) {
      if (!lanes.has(lane.id)) {
        lanes.set(lane.id, lane);
      }
    }
  }
  return Array.from(lanes.values());
}

export function collectRpcTopologyLanes(
  topology: IRpcLanesTopology,
): IRpcLaneDefinition[] {
  const lanes = new Map<string, IRpcLaneDefinition>();
  for (const binding of topology.bindings) {
    lanes.set(binding.lane.id, binding.lane);
  }
  for (const profile of Object.values(topology.profiles)) {
    for (const lane of profile.serve) {
      if (!lanes.has(lane.id)) {
        lanes.set(lane.id, lane);
      }
    }
  }
  return Array.from(lanes.values());
}
