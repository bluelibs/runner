import type { IncomingMessage, ServerResponse } from "http";

import {
  jsonErrorResponse,
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  NOT_FOUND_RESPONSE,
  respondJson,
  respondStream,
} from "./httpResponse";
import { isMultipart, parseMultipartInput } from "./multipart";
import { readJsonBody } from "./requestBody";
import type { Serializer } from "../../globals/resources/tunnel/serializer";
import { requestUrl, resolveTargetFromRequest } from "./router";
import { errorMessage, safeLogError } from "./logging";
import type { Authenticator, AllowListGuard, RequestHandler } from "./types";
import type { ExposureRouter } from "./router";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "./resourceTypes";
import { ExposureRequestContext } from "./requestContext";
import { CancellationError, isCancellationError } from "../../errors";
import { applyCorsActual, handleCorsPreflight } from "./cors";
import { createAbortControllerForRequest, getContentType } from "./utils";
import { computeAllowList } from "../tunnel.allowlist";

interface RequestProcessingDeps {
  store: NodeExposureDeps["store"];
  taskRunner: NodeExposureDeps["taskRunner"];
  eventManager: NodeExposureDeps["eventManager"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  router: ExposureRouter;
  cors?: NodeExposureHttpCorsConfig;
  serializer: Serializer;
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
  } = deps;
  const serializer = deps.serializer;
  const cors = deps.cors;

  const processTaskRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }

    const auth = authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response, serializer);
      return;
    }

    const allowError = allowList.ensureTask(taskId);
    if (allowError) {
      applyCorsActual(req, res, cors);
      respondJson(res, allowError, serializer);
      return;
    }

    const storeTask = store.tasks.get(taskId);
    if (!storeTask) {
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(404, `Task ${taskId} not found`, "NOT_FOUND"),
        serializer,
      );
      return;
    }

    // Cancellation wiring per request
    const controller = createAbortControllerForRequest(req, res);

    try {
      const contentType = getContentType(req.headers);
      const url = requestUrl(req);

      // Provide request context while executing the task
      const provide = <T>(fn: () => Promise<T>) =>
        ExposureRequestContext.provide(
          {
            req,
            res,
            url,
            basePath: router.basePath,
            headers: req.headers,
            method: req.method,
            signal: controller.signal,
          },
          fn,
        );

      if (isMultipart(contentType)) {
        const multipart = await parseMultipartInput(
          req as any,
          controller.signal,
          serializer,
        );
        if (!multipart.ok) {
          applyCorsActual(req, res, cors);
          respondJson(res, multipart.response, serializer);
          return;
        }
        const finalizePromise = multipart.finalize;
        let taskError: unknown = undefined;
        let taskResult: unknown;
        try {
          taskResult = await provide(() =>
            taskRunner.run(storeTask.task, multipart.value),
          );
        } catch (err) {
          taskError = err;
        }
        const finalize = await finalizePromise;
        if (!finalize.ok) {
          if (!res.writableEnded && !(res as any).headersSent) {
            applyCorsActual(req, res, cors);
            respondJson(res, finalize.response, serializer);
          }
          return;
        }
        if (taskError) {
          throw taskError;
        }
        // Streamed responses: if task returned a readable or a streaming wrapper
        if (
          !res.writableEnded &&
          taskResult &&
          typeof (taskResult as any).pipe === "function"
        ) {
          applyCorsActual(req, res, cors);
          respondStream(res, taskResult as any);
          return;
        }
        if (
          !res.writableEnded &&
          taskResult &&
          typeof taskResult === "object" &&
          (taskResult as any).stream
        ) {
          applyCorsActual(req, res, cors);
          respondStream(res, taskResult as any);
          return;
        }
        // If the task already handled the response (wrote headers/body),
        // skip the default JSON envelope.
        if (res.writableEnded || (res as any).headersSent) return;
        applyCorsActual(req, res, cors);
        respondJson(res, jsonOkResponse({ result: taskResult }), serializer);
        return;
      }

      // Raw-body streaming mode: when content-type is application/octet-stream
      // we do not pre-consume the request body and allow task to read from context.req
      if (/^application\/octet-stream(?:;|$)/i.test(contentType)) {
        const result = await provide(() =>
          taskRunner.run(storeTask.task, undefined),
        );
        if (
          !res.writableEnded &&
          result &&
          typeof (result as any).pipe === "function"
        ) {
          applyCorsActual(req, res, cors);
          respondStream(res, result as any);
          return;
        }
        if (
          !res.writableEnded &&
          result &&
          typeof result === "object" &&
          (result as any).stream
        ) {
          applyCorsActual(req, res, cors);
          respondStream(res, result as any);
          return;
        }
        // If the task streamed a custom response, do not append JSON.
        if (res.writableEnded || (res as any).headersSent) return;
        applyCorsActual(req, res, cors);
        respondJson(res, jsonOkResponse({ result }), serializer);
        return;
      }

      const body = await readJsonBody<{ input?: unknown }>(
        req,
        controller.signal,
        serializer,
      );
      if (!body.ok) {
        applyCorsActual(req, res, cors);
        respondJson(res, body.response, serializer);
        return;
      }
      const payload = (() => {
        if (!body.value || typeof body.value !== "object") {
          return body.value as unknown;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            body.value as Record<string, unknown>,
            "input",
          )
        ) {
          return (body.value as Record<string, unknown>).input;
        }
        return body.value as unknown;
      })();
      const result = await provide(() =>
        taskRunner.run(storeTask.task, payload),
      );
      if (
        !res.writableEnded &&
        result &&
        typeof (result as any).pipe === "function"
      ) {
        applyCorsActual(req, res, cors);
        respondStream(res, result as any);
        return;
      }
      if (
        !res.writableEnded &&
        result &&
        typeof result === "object" &&
        (result as any).stream
      ) {
        applyCorsActual(req, res, cors);
        respondStream(res, result as any);
        return;
      }
      // If the task already wrote a response, do nothing further.
      if (res.writableEnded || (res as any).headersSent) return;
      applyCorsActual(req, res, cors);
      respondJson(res, jsonOkResponse({ result }), serializer);
    } catch (error) {
      if (isCancellationError(error)) {
        if (!res.writableEnded && !(res as any).headersSent) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"),
            serializer,
          );
        }
        return;
      }
      const logMessage = errorMessage(error);
      const displayMessage =
        error instanceof Error && error.message
          ? error.message
          : "Internal Error";
      safeLogError(logger, "exposure.task.error", {
        error: logMessage,
      });
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(500, displayMessage, "INTERNAL_ERROR"),
        serializer,
      );
    }
  };

  const processEventRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    eventId: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }

    const auth = authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response, serializer);
      return;
    }

    const allowError = allowList.ensureEvent(eventId);
    if (allowError) {
      applyCorsActual(req, res, cors);
      respondJson(res, allowError);
      return;
    }

    const storeEvent = store.events.get(eventId);
    if (!storeEvent) {
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(404, `Event ${eventId} not found`, "NOT_FOUND"),
        serializer,
      );
      return;
    }

    // Cancellation wiring for events as well
    const controller = createAbortControllerForRequest(req, res);
    try {
      const body = await readJsonBody<{ payload?: unknown }>(
        req,
        controller.signal,
        serializer,
      );
      if (!body.ok) {
        applyCorsActual(req, res, cors);
        respondJson(res, body.response, serializer);
        return;
      }
      await eventManager.emit(
        storeEvent.event,
        body.value?.payload,
        "exposure:http",
      );
      applyCorsActual(req, res, cors);
      respondJson(res, jsonOkResponse(), serializer);
    } catch (error) {
      if (isCancellationError(error)) {
        if (!res.writableEnded && !(res as any).headersSent) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"),
            serializer,
          );
        }
        return;
      }
      const logMessage = errorMessage(error);
      const displayMessage =
        error instanceof Error && error.message
          ? error.message
          : "Internal Error";
      safeLogError(logger, "exposure.event.error", {
        error: logMessage,
      });
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(500, displayMessage, "INTERNAL_ERROR"),
        serializer,
      );
    }
  };

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
    const auth = authenticator(req);
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
