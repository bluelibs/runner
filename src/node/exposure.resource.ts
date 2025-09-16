import { defineResource } from "../define";
import { globalResources } from "../globals/globalResources";

import { createNodeExposure } from "./exposure/createNodeExposure";
import type {
  NodeExposureConfig,
  NodeExposureHandlers,
} from "./exposure/resourceTypes";

export type { NodeExposureHttpAuthConfig } from "./exposure/authenticator";

export const nodeExposure = defineResource({
  id: "platform.node.resources.exposure",
  meta: {
    title: "Node Exposure (HTTP)",
    description:
      "Exposes Runner tasks and events over HTTP so a tunnel client can invoke them.",
  },
  dependencies: {
    store: globalResources.store,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
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
