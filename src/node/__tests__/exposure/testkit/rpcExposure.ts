import { defineResource } from "../../../../define";
import { createMessageError } from "../../../../errors";
import { r } from "../../../../public";
import type {
  NodeExposureConfig,
  NodeExposureHandlers,
} from "../../../exposure/resourceTypes";
import { rpcLanesResource } from "../../../rpc-lanes";
import type { RpcLanesResourceValue } from "../../../rpc-lanes/types";

let exposureCounter = 0;

function nextExposureId(): string {
  exposureCounter += 1;
  return `tests.rpc.exposure.harness.${exposureCounter}`;
}

export const rpcExposure = {
  with(config: NodeExposureConfig = {}) {
    const id = nextExposureId();
    const lane = r
      .rpcLane(`${id}.lane`)
      .applyTo(() => true)
      .build();
    const communicator = defineResource({
      id: `${id}.communicator`,
      init: async () => ({
        task: async () => {
          throw createMessageError(
            "Unexpected remote task call while rpc lane is served locally.",
          );
        },
        event: async () => {
          throw createMessageError(
            "Unexpected remote event call while rpc lane is served locally.",
          );
        },
        eventWithResult: async () => {
          throw createMessageError(
            "Unexpected remote eventWithResult call while rpc lane is served locally.",
          );
        },
      }),
    });

    const rpcExposure = rpcLanesResource.with({
      profile: "server",
      mode: "network",
      topology: r.rpcLane.topology({
        profiles: {
          server: { serve: [lane] },
        },
        bindings: [{ lane, communicator }],
      }),
      exposure: {
        http: config.http ?? {},
      },
    });

    return defineResource({
      id: `${id}.wrapper`,
      register: [communicator, rpcExposure] as any,
      dependencies: {
        rpcExposure: rpcLanesResource,
      },
      init: async (_config, deps) => {
        const value = deps.rpcExposure as RpcLanesResourceValue;
        const handlers = value.exposure?.getHandlers?.() as
          | NodeExposureHandlers
          | null
          | undefined;
        if (!handlers) {
          throw createMessageError(
            "Failed to resolve rpc-lanes exposure handlers.",
          );
        }
        return handlers;
      },
    });
  },
};
