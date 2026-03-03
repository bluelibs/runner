import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import {
  resolveRpcLaneState,
  toRpcLanesResourceValue,
  collectRpcLaneCommunicatorResourceDependencies,
} from "./RpcLanesInternals";
import type { RpcLanesResourceConfig, RpcLanesResourceValue } from "./types";
import { rpcLanesResourceConfigSchema } from "./configSchema";
import { enforceRpcLaneAuthReadiness } from "./rpcLanes.auth";
import {
  applyRpcLanesModeRouting,
  startRpcLanesExposure,
  type RpcLanesDependencies,
} from "./rpcLanes.runtime.utils";

export const rpcLanesResource = defineResource<
  RpcLanesResourceConfig,
  Promise<RpcLanesResourceValue>
>({
  id: "platform.node.resources.rpcLanes",
  tags: [globalTags.rpcLanes],
  configSchema: rpcLanesResourceConfigSchema,
  dependencies: (config) => ({
    store: globalResources.store,
    authValidators: globalTags.authValidator,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
    serializer: globalResources.serializer,
    ...collectRpcLaneCommunicatorResourceDependencies(config),
  }),
  async init(config, dependencies) {
    const typedDependencies = dependencies as RpcLanesDependencies;
    const store = typedDependencies.store;
    const resolved = resolveRpcLaneState(config, typedDependencies, store);
    const resourceId = "platform.node.resources.rpcLanes";
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

    return toRpcLanesResourceValue(resolved, exposure);
  },
  async dispose(value) {
    if (value?.exposure) {
      await value.exposure.close();
    }
  },
});
