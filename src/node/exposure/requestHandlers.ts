import type { IncomingMessage, ServerResponse } from "http";

import {
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  NOT_FOUND_RESPONSE,
  respondJson,
} from "./httpResponse";
import type { SerializerLike } from "../../serializer";
import { requestUrl, resolveTargetFromRequest } from "./router";
import type { Authenticator, AllowListGuard, RequestHandler } from "./types";
import type { ExposureRouter } from "./router";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "./resourceTypes";
import { applyCorsActual, handleCorsPreflight } from "./cors";
import { computeAllowList } from "../tunnel/allowlist";
import { createTaskHandler } from "./handlers/taskHandler";
import { createEventHandler } from "./handlers/eventHandler";

export interface RequestProcessingDeps {
  store: NodeExposureDeps["store"];
  taskRunner: NodeExposureDeps["taskRunner"];
  eventManager: NodeExposureDeps["eventManager"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  router: ExposureRouter;
  cors?: NodeExposureHttpCorsConfig;
  serializer: SerializerLike;
  limits?: {
    json?: { maxSize?: number };
    multipart?: any; // avoid circular or strict import if possible
  };
}

export interface NodeExposureRequestHandlers {
  handleTask: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleEvent: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleDiscovery: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleRequest: RequestHandler;
}

export function createRequestHandlers(
  deps: RequestProcessingDeps,
): NodeExposureRequestHandlers {
  const {
    store,
    taskRunner,
    eventManager,
    logger,
    authenticator,
    allowList,
    router,
    limits,
  } = deps;
  const serializer = deps.serializer;
  const cors = deps.cors;

  const processTaskRequest = createTaskHandler({
    store,
    taskRunner,
    logger,
    authenticator,
    allowList,
    router,
    cors,
    serializer,
    limits,
  });

  const processEventRequest = createEventHandler({
    store,
    eventManager,
    logger,
    authenticator,
    allowList,
    cors,
    serializer,
    limits,
  });

  const handleTask = async (req: IncomingMessage, res: ServerResponse) => {
    if (handleCorsPreflight(req, res, cors)) return;
    const target = resolveTargetFromRequest(req, router, "task");
    if (!target.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, target.response);
      return;
    }
    await processTaskRequest(req, res, target.id);
  };

  const handleEvent = async (req: IncomingMessage, res: ServerResponse) => {
    if (handleCorsPreflight(req, res, cors)) return;
    const target = resolveTargetFromRequest(req, router, "event");
    if (!target.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, target.response);
      return;
    }
    await processEventRequest(req, res, target.id);
  };

  const handleDiscovery = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    // Allow GET and POST for discovery
    if (req.method !== "GET" && req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }
    const auth = await authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response, serializer);
      return;
    }
    const list = computeAllowList(store);
    applyCorsActual(req, res, cors);
    respondJson(
      res,
      jsonOkResponse({
        result: {
          allowList: {
            enabled: list.enabled,
            tasks: Array.from(list.taskIds),
            events: Array.from(list.eventIds),
          },
        },
      }),
      serializer,
    );
  };

  const handleRequest: RequestHandler = async (req, res) => {
    const url = requestUrl(req);
    const target = router.extract(url.pathname);
    if (!target) {
      if (!router.isUnderBase(url.pathname)) {
        return false;
      }
      if (handleCorsPreflight(req, res, cors)) return true;
      applyCorsActual(req, res, cors);
      respondJson(res, NOT_FOUND_RESPONSE, serializer);
      return true;
    }
    if (target.kind === "task") {
      if (handleCorsPreflight(req, res, cors)) return true;
      await processTaskRequest(req, res, target.id);
    } else if (target.kind === "event") {
      if (handleCorsPreflight(req, res, cors)) return true;
      await processEventRequest(req, res, target.id);
    } else if (target.kind === "discovery") {
      if (handleCorsPreflight(req, res, cors)) return true;
      await handleDiscovery(req, res);
    }
    return true;
  };

  return { handleTask, handleEvent, handleDiscovery, handleRequest };
}
