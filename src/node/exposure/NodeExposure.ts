import {
  createNodeExposure,
  type NodeExposureAuthorizationOptions,
} from "./createNodeExposure";
import type {
  NodeExposureDeps,
  NodeExposureHandlers,
  NodeExposureHttpConfig,
} from "./resourceTypes";
import type { NodeExposurePolicySnapshot } from "./policy";

export interface NodeExposureOptions {
  http?: NodeExposureHttpConfig;
  deps: NodeExposureDeps;
  policy: NodeExposurePolicySnapshot;
  authorization?: NodeExposureAuthorizationOptions;
  ownerResourceId?: string;
}

export class NodeExposure {
  private handlers: NodeExposureHandlers | null = null;

  constructor(private readonly options: NodeExposureOptions) {}

  async start(): Promise<NodeExposureHandlers> {
    if (this.handlers) {
      return this.handlers;
    }

    this.handlers = await createNodeExposure(
      { http: this.options.http },
      this.options.deps,
      {
        policy: this.options.policy,
        authorization: this.options.authorization,
        sourceResourceId:
          this.options.ownerResourceId ?? "platform.node.resources.rpcLanes",
      },
    );

    return this.handlers;
  }

  getHandlers(): NodeExposureHandlers | null {
    return this.handlers;
  }

  async close(): Promise<void> {
    if (!this.handlers) {
      return;
    }

    const currentHandlers = this.handlers;
    this.handlers = null;
    await currentHandlers.close();
  }
}
