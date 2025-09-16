import type * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";

import { globalResources } from "../../globals/globalResources";
import type { ResourceDependencyValuesType } from "../../defs";
import type { NodeExposureHttpAuthConfig } from "./authenticator";
import type { RequestHandler } from "./types";

export type NodeExposureDependencyMap = {
  store: typeof globalResources.store;
  taskRunner: typeof globalResources.taskRunner;
  eventManager: typeof globalResources.eventManager;
  logger: typeof globalResources.logger;
};

export type NodeExposureDeps =
  ResourceDependencyValuesType<NodeExposureDependencyMap>;

export interface NodeExposureHttpConfig {
  basePath?: string;
  server?: http.Server;
  listen?: { port: number; host?: string };
  auth?: NodeExposureHttpAuthConfig;
}

export interface NodeExposureConfig {
  http?: NodeExposureHttpConfig;
}

export interface NodeExposureHandlers {
  handleRequest: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTask: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleEvent: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  createRequestListener: () => http.RequestListener;
  createServer: () => http.Server;
  attachTo: (server: http.Server) => () => void;
  server?: http.Server | null;
  basePath: string;
  close: () => Promise<void>;
}
