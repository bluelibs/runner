import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import { rpcLanesResourceConfigSchema } from "./configSchema";
import { enforceRpcLaneAuthReadiness } from "./rpcLanes.auth";
import {
  collectRpcLaneCommunicatorResourceDependencies,
  resolveRpcLaneState,
  toRpcLanesResourceValue,
} from "./RpcLanesInternals";
import {
  applyRpcLanesModeRouting,
  startRpcLanesExposure,
  type RpcLanesDependencies,
} from "./rpcLanes.runtime.utils";
import type { RpcLanesResourceConfig, RpcLanesResourceValue } from "./types";

export const RPC_LANES_RESOURCE_ID = "rpcLanes";

export const rpcLanesResource = defineResource<
  RpcLanesResourceConfig,
  Promise<RpcLanesResourceValue>
>({
  id: RPC_LANES_RESOURCE_ID,
  tags: [globalTags.rpcLanes],
  configSchema: rpcLanesResourceConfigSchema,
  dependencies: (config) => ({
    store: globalResources.store,
    authValidators: globalTags.authValidator,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
    serializer: config.serializer ?? globalResources.serializer,
    ...collectRpcLaneCommunicatorResourceDependencies(config),
  }),
  async init(config, dependencies) {
    const typedDependencies = dependencies as RpcLanesDependencies;
    const store = typedDependencies.store;
    const resolved = resolveRpcLaneState(config, typedDependencies, store);
    const resourceId = store.findIdByDefinition(rpcLanesResource);
    enforceRpcLaneAuthReadiness(config, resolved);

    applyRpcLanesModeRouting({
      config,
      resolved,
      dependencies: typedDependencies,
      resourceId,
    });

    const exposure = await startRpcLanesExposure({
      config,
      resolved,
      dependencies: typedDependencies,
      resourceId,
    });

    return toRpcLanesResourceValue(resolved, exposure, (id) =>
      store.findIdByDefinition(id),
    );
  },
  async cooldown(value) {
    if (value?.exposure) {
      await value.exposure.close();
    }
  },
  async dispose(value) {
    if (value?.exposure) {
      await value.exposure.close();
    }
  },
});
