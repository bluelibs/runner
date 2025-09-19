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

interface RequestProcessingDeps {
  store: NodeExposureDeps["store"];
  taskRunner: NodeExposureDeps["taskRunner"];
  eventManager: NodeExposureDeps["eventManager"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  router: ExposureRouter;
  cors?: NodeExposureHttpCorsConfig;
}

export interface NodeExposureRequestHandlers {
  handleTask: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleEvent: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
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
  const cors = deps.cors;

  const processTaskRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE);
      return;
    }

    const auth = authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response);
      return;
    }

    const allowError = allowList.ensureTask(taskId);
    if (allowError) {
      applyCorsActual(req, res, cors);
      respondJson(res, allowError);
      return;
    }

    const storeTask = store.tasks.get(taskId);
    if (!storeTask) {
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(404, `Task ${taskId} not found`, "NOT_FOUND"),
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
        );
        if (!multipart.ok) {
          applyCorsActual(req, res, cors);
          respondJson(res, multipart.response);
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
            respondJson(res, finalize.response);
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
        respondJson(res, jsonOkResponse({ result: taskResult }));
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
        respondJson(res, jsonOkResponse({ result }));
        return;
      }

      const body = await readJsonBody<{ input?: unknown }>(
        req,
        controller.signal,
      );
      if (!body.ok) {
        applyCorsActual(req, res, cors);
        respondJson(res, body.response);
        return;
      }
      const result = await provide(() =>
        taskRunner.run(storeTask.task, body.value?.input),
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
      respondJson(res, jsonOkResponse({ result }));
    } catch (error) {
      if (isCancellationError(error)) {
        if (!res.writableEnded && !(res as any).headersSent) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"),
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
      );
    }
  };

  const processEventRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    eventId: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE);
      return;
    }

    const auth = authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response);
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
      );
      return;
    }

    // Cancellation wiring for events as well
    const controller = createAbortControllerForRequest(req, res);
    try {
      const body = await readJsonBody<{ payload?: unknown }>(
        req,
        controller.signal,
      );
      if (!body.ok) {
        applyCorsActual(req, res, cors);
        respondJson(res, body.response);
        return;
      }
      await eventManager.emit(
        storeEvent.event,
        body.value?.payload,
        "exposure:http",
      );
      applyCorsActual(req, res, cors);
      respondJson(res, jsonOkResponse());
    } catch (error) {
      if (isCancellationError(error)) {
        if (!res.writableEnded && !(res as any).headersSent) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"),
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

  const handleRequest: RequestHandler = async (req, res) => {
    const url = requestUrl(req);
    const target = router.extract(url.pathname);
    if (!target) {
      if (!router.isUnderBase(url.pathname)) {
        return false;
      }
      if (handleCorsPreflight(req, res, cors)) return true;
      applyCorsActual(req, res, cors);
      respondJson(res, NOT_FOUND_RESPONSE);
      return true;
    }
    if (target.kind === "task") {
      if (handleCorsPreflight(req, res, cors)) return true;
      await processTaskRequest(req, res, target.id);
    } else {
      if (handleCorsPreflight(req, res, cors)) return true;
      await processEventRequest(req, res, target.id);
    }
    return true;
  };

  return { handleTask, handleEvent, handleRequest };
}
