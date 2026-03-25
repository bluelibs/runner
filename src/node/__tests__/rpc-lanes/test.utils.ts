import type {
  IRpcLaneCommunicator,
  IRpcLaneTopologyBinding,
  IRpcLaneDefinition,
} from "../../../types/rpcLane";
import { defineResource } from "../../../define";
import { r } from "../../../public";

function createDefaultRpcLaneCommunicator(): IRpcLaneCommunicator {
  return {
    task: async () => "remote",
    event: async () => undefined,
  };
}

export function createMockRpcLaneCommunicator(
  id: string,
  overrides: Partial<IRpcLaneCommunicator> = {},
) {
  return defineResource({
    id,
    init: async () => ({
      ...createDefaultRpcLaneCommunicator(),
      ...overrides,
    }),
  });
}

export function createClientRpcLaneTopology(
  bindings: readonly IRpcLaneTopologyBinding[],
) {
  return r.rpcLane.topology({
    profiles: {
      client: { serve: [] },
    },
    bindings,
  });
}

export function createServerRpcLaneTopology(
  serve: readonly IRpcLaneDefinition[],
  bindings: readonly IRpcLaneTopologyBinding[],
) {
  return r.rpcLane.topology({
    profiles: {
      server: { serve },
    },
    bindings,
  });
}
