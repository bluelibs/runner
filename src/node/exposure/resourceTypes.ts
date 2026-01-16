import type * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";

import { globalResources } from "../../globals/globalResources";
import type { ResourceDependencyValuesType } from "../../defs";
import type { NodeExposureHttpAuthConfig } from "./authenticator";
import type { MultipartLimits } from "./multipart";

export interface JsonLimits {
  maxSize?: number;
}

export type NodeExposureDependencyMap = {
  store: typeof globalResources.store;
  taskRunner: typeof globalResources.taskRunner;
  eventManager: typeof globalResources.eventManager;
  logger: typeof globalResources.logger;
  serializer: typeof globalResources.serializer;
};

export type NodeExposureDeps =
  ResourceDependencyValuesType<NodeExposureDependencyMap>;

export interface NodeExposureHttpConfig {
  basePath?: string;
  server?: http.Server;
  listen?: { port: number; host?: string };
  auth?: NodeExposureHttpAuthConfig;
  cors?: NodeExposureHttpCorsConfig;
  limits?: {
    json?: JsonLimits;
    multipart?: MultipartLimits;
  };
  /**
   * Opt out of fail-closed exposure (not recommended).
   * When true and no server-mode tunnel is registered, exposure is open.
   */
  dangerouslyAllowOpenExposure?: boolean;
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
  handleDiscovery: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  createRequestListener: () => http.RequestListener;
  createServer: () => http.Server;
  attachTo: (server: http.Server) => () => void;
  server?: http.Server | null;
  basePath: string;
  close: () => Promise<void>;
}

export interface NodeExposureHttpCorsConfig {
  /**
   * Allowed origin(s). When omitted, defaults to "*".
   * - string: exact origin value to send
   * - string[]: allow-list; request origin must match an item
   * - RegExp: allow when test(origin) is true
   * - function: returns the origin to send or null to disallow
   */
  origin?:
    | string
    | string[]
    | RegExp
    | ((origin: string | undefined) => string | null | undefined);
  /** Which methods are allowed on preflight; defaults to ["POST", "OPTIONS"]. */
  methods?: string[];
  /** Access-Control-Allow-Headers value. If omitted, echoes Access-Control-Request-Headers. */
  allowedHeaders?: string[];
  /** Expose response headers for actual requests. */
  exposedHeaders?: string[];
  /** Whether to include Access-Control-Allow-Credentials: true. */
  credentials?: boolean;
  /** Max age in seconds for preflight caching. */
  maxAge?: number;
  /** Whether to append Vary: Origin when a specific origin is returned. Default true. */
  varyOrigin?: boolean;
}
