import type { IncomingMessage, ServerResponse } from "http";

import {
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  NOT_FOUND_RESPONSE,
  respondJson,
} from "./httpResponse";
import type { SerializerLike } from "../../serializer";
import { requestUrl, resolveTargetFromRequest } from "./router";
import type {
  Authenticator,
  AllowListGuard,
  RequestHandler,
  JsonResponse,
} from "./types";
import type { ExposureRouter } from "./router";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "./resourceTypes";
import { applyCorsActual, handleCorsPreflight } from "./cors";
import { createTaskHandler } from "./handlers/taskHandler";
import { createEventHandler } from "./handlers/eventHandler";
import { safeLogWarn } from "./logging";
import { ensureRequestId, getRequestId } from "./requestIdentity";
import type { MultipartLimits } from "./multipart";
import type { NodeExposurePolicySnapshot } from "./policy";
import { EMPTY_NODE_EXPOSURE_POLICY } from "./policy";

enum ExposureAuditLogKey {
  AuthFailure = "exposure.auth.failure",
}

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
    multipart?: MultipartLimits;
  };
  disableDiscovery?: boolean;
  policy?: NodeExposurePolicySnapshot;
  sourceResourceId?: string;
  authorizeTask?: (
    req: IncomingMessage,
    taskId: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
  authorizeEvent?: (
    req: IncomingMessage,
    eventId: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
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
  const policy = deps.policy ?? EMPTY_NODE_EXPOSURE_POLICY;
  const serializer = deps.serializer;
  const cors = deps.cors;

  const extractErrorCode = (response: JsonResponse): string | undefined => {
    if (!response.body || typeof response.body !== "object") return;
    const error = (response.body as { error?: unknown }).error;
    if (!error || typeof error !== "object") return;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  };

  const auditedAuthenticator: Authenticator = async (req) => {
    const authResult = await authenticator(req);
    if (!authResult.ok) {
      const path = requestUrl(req).pathname;
      safeLogWarn(logger, ExposureAuditLogKey.AuthFailure, {
        requestId: getRequestId(req),
        method: req.method ?? "GET",
        path,
        status: authResult.response.status,
        code: extractErrorCode(authResult.response),
      });
    }
    return authResult;
  };

  const prepareRequest = (req: IncomingMessage, res: ServerResponse): void => {
    ensureRequestId(req, res);
  };

  const resolveTaskAllowAsyncContext = (taskId: string): boolean => {
    const decision = policy.taskAllowAsyncContext[taskId];
    return decision ?? true;
  };

  const resolveTaskAsyncContextAllowList = (
    taskId: string,
  ): readonly string[] | undefined => {
    return policy.taskAsyncContextAllowList[taskId];
  };

  const resolveEventAllowAsyncContext = (eventId: string): boolean => {
    const decision = policy.eventAllowAsyncContext[eventId];
    return decision ?? true;
  };

  const resolveEventAsyncContextAllowList = (
    eventId: string,
  ): readonly string[] | undefined => {
    return policy.eventAsyncContextAllowList[eventId];
  };

  const processTaskRequest = createTaskHandler({
    store,
    taskRunner,
    logger,
    authenticator: auditedAuthenticator,
    allowList,
    router,
    cors,
    serializer,
    limits,
    allowAsyncContext: resolveTaskAllowAsyncContext,
    resolveAsyncContextAllowList: resolveTaskAsyncContextAllowList,
    authorizeTask: deps.authorizeTask,
    sourceResourceId: deps.sourceResourceId,
  });

  const processEventRequest = createEventHandler({
    store,
    eventManager,
    logger,
    authenticator: auditedAuthenticator,
    allowList,
    cors,
    serializer,
    limits,
    allowAsyncContext: resolveEventAllowAsyncContext,
    resolveAsyncContextAllowList: resolveEventAsyncContextAllowList,
    authorizeEvent: deps.authorizeEvent,
    sourceResourceId: deps.sourceResourceId,
  });

  const handleTask = async (req: IncomingMessage, res: ServerResponse) => {
    if (handleCorsPreflight(req, res, cors)) return;
    prepareRequest(req, res);
    const target = resolveTargetFromRequest(req, router, "task");
    if (!target.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, target.response, serializer);
      return;
    }
    await processTaskRequest(req, res, target.id);
  };

  const handleEvent = async (req: IncomingMessage, res: ServerResponse) => {
    if (handleCorsPreflight(req, res, cors)) return;
    prepareRequest(req, res);
    const target = resolveTargetFromRequest(req, router, "event");
    if (!target.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, target.response, serializer);
      return;
    }
    await processEventRequest(req, res, target.id);
  };

  const handleDiscovery = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    prepareRequest(req, res);
    if (deps.disableDiscovery) {
      applyCorsActual(req, res, cors);
      respondJson(res, NOT_FOUND_RESPONSE, serializer);
      return;
    }
    if (req.method !== "GET") {
      applyCorsActual(req, res, cors);
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }
    const auth = await auditedAuthenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response, serializer);
      return;
    }
    applyCorsActual(req, res, cors);
    respondJson(
      res,
      jsonOkResponse({
        result: {
          allowList: {
            enabled: policy.enabled,
            tasks: [...policy.taskIds],
            events: [...policy.eventIds],
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
      prepareRequest(req, res);
      applyCorsActual(req, res, cors);
      respondJson(res, NOT_FOUND_RESPONSE, serializer);
      return true;
    }
    if (handleCorsPreflight(req, res, cors)) return true;
    if (target.kind === "discovery") {
      await handleDiscovery(req, res);
      return true;
    }
    prepareRequest(req, res);
    if (target.kind === "task") {
      await processTaskRequest(req, res, target.id);
    } else if (target.kind === "event") {
      await processEventRequest(req, res, target.id);
    }
    return true;
  };

  return { handleTask, handleEvent, handleDiscovery, handleRequest };
}
