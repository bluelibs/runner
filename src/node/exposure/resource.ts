import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";

import { createNodeExposure } from "./createNodeExposure";
import type { NodeExposureConfig } from "./resourceTypes";

export type { NodeExposureHttpAuthConfig } from "./authenticator";

export const nodeExposure = defineResource({
  id: "platform.node.resources.exposure",
  meta: {
    title: "Node Exposure (HTTP)",
    description:
      "Exposes Runner tasks and events over HTTP so a tunnel client can invoke them.",
  },
  dependencies: {
    store: globalResources.store,
    authValidators: globalTags.authValidator,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
    serializer: globalResources.serializer,
  },
  async init(cfg: NodeExposureConfig, deps) {
    return createNodeExposure(cfg, deps);
  },
  async dispose(value) {
    if (value?.close) {
      await value.close();
    }
  },
});
