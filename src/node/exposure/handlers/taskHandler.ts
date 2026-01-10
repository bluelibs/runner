import type { IncomingMessage, ServerResponse } from "http";
import {
  jsonErrorResponse,
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  respondJson,
  respondStream,
} from "../httpResponse";
import { isMultipart, parseMultipartInput } from "../multipart";
import { readJsonBody } from "../requestBody";
import type { SerializerLike } from "../../../serializer";
import { errorMessage, safeLogError } from "../logging";
import type {
  Authenticator,
  AllowListGuard,
  StreamingResponse,
} from "../types";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "../resourceTypes";
import { isCancellationError } from "../../../errors";
import { applyCorsActual } from "../cors";
import { createAbortControllerForRequest, getContentType } from "../utils";
import { sanitizeErrorResponse } from "./errorHandlers";
import { withExposureContext } from "./contextWrapper";

interface TaskHandlerDeps {
  store: NodeExposureDeps["store"];
  taskRunner: NodeExposureDeps["taskRunner"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  router: { basePath: string };
  cors?: NodeExposureHttpCorsConfig;
  serializer: SerializerLike;
  limits?: {
    json?: { maxSize?: number };
    multipart?: any;
  };
}

export const createTaskHandler = (deps: TaskHandlerDeps) => {
  const {
    store,
    taskRunner,
    logger,
    authenticator,
    allowList,
    router,
    cors,
    serializer,
    limits,
  } = deps;

  const isReadableStream = (value: unknown): value is NodeJS.ReadableStream =>
    !!value && typeof (value as { pipe?: unknown }).pipe === "function";

  const isStreamingResponse = (value: unknown): value is StreamingResponse =>
    !!value &&
    typeof value === "object" &&
    "stream" in value &&
    isReadableStream((value as { stream?: unknown }).stream);

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }

    const auth = await authenticator(req);
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

      const runWithContext = <T>(fn: () => Promise<T>) =>
        withExposureContext(
          req,
          res,
          controller,
          { store, router, serializer },
          fn,
        );

      if (isMultipart(contentType)) {
        const multipart = await parseMultipartInput(
          req,
          controller.signal,
          serializer,
          limits?.multipart,
        );
        if (!multipart.ok) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            sanitizeErrorResponse(multipart.response),
            serializer,
          );
          return;
        }
        const finalizePromise = multipart.finalize;
        let taskError: unknown = undefined;
        let taskResult: unknown;
        try {
          taskResult = await runWithContext(() =>
            taskRunner.run(storeTask.task, multipart.value),
          );
        } catch (err) {
          taskError = err;
        }
        const finalize = await finalizePromise;
        if (!finalize.ok) {
          if (!res.writableEnded && !res.headersSent) {
            applyCorsActual(req, res, cors);
            respondJson(
              res,
              sanitizeErrorResponse(finalize.response),
              serializer,
            );
          }
          return;
        }
        if (taskError) {
          throw taskError;
        }
        // Streamed responses: if task returned a readable or a streaming wrapper
        if (!res.writableEnded && isReadableStream(taskResult)) {
          applyCorsActual(req, res, cors);
          respondStream(res, taskResult);
          return;
        }
        if (!res.writableEnded && isStreamingResponse(taskResult)) {
          applyCorsActual(req, res, cors);
          respondStream(res, taskResult);
          return;
        }
        // If the task already handled the response (wrote headers/body),
        // skip the default JSON envelope.
        if (res.writableEnded || res.headersSent) return;
        applyCorsActual(req, res, cors);
        respondJson(res, jsonOkResponse({ result: taskResult }), serializer);
        return;
      }

      // Raw-body streaming mode: when content-type is application/octet-stream
      // we do not pre-consume the request body and allow task to read from context.req
      if (/^application\/octet-stream(?:;|$)/i.test(contentType)) {
        const result = await runWithContext(() =>
          taskRunner.run(storeTask.task, undefined),
        );
        if (!res.writableEnded && isReadableStream(result)) {
          applyCorsActual(req, res, cors);
          respondStream(res, result);
          return;
        }
        if (!res.writableEnded && isStreamingResponse(result)) {
          applyCorsActual(req, res, cors);
          respondStream(res, result);
          return;
        }
        // If the task streamed a custom response, do not append JSON.
        if (res.writableEnded || res.headersSent) return;
        applyCorsActual(req, res, cors);
        respondJson(res, jsonOkResponse({ result }), serializer);
        return;
      }

      const body = await readJsonBody<{ input?: unknown }>(
        req,
        controller.signal,
        serializer,
        limits?.json?.maxSize,
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
      const result = await runWithContext(() =>
        taskRunner.run(storeTask.task, payload),
      );
      if (!res.writableEnded && isReadableStream(result)) {
        applyCorsActual(req, res, cors);
        respondStream(res, result);
        return;
      }
      if (!res.writableEnded && isStreamingResponse(result)) {
        applyCorsActual(req, res, cors);
        respondStream(res, result);
        return;
      }
      // If the task already wrote a response, do nothing further.
      if (res.writableEnded || res.headersSent) return;
      applyCorsActual(req, res, cors);
      respondJson(res, jsonOkResponse({ result }), serializer);
    } catch (error) {
      if (isCancellationError(error)) {
        if (!res.writableEnded && !res.headersSent) {
          applyCorsActual(req, res, cors);
          respondJson(
            res,
            jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"),
            serializer,
          );
        }
        return;
      }
      // Detect application-defined errors and surface minimal identity
      let appErrorExtra: Record<string, unknown> | undefined;
      try {
        for (const helper of store.errors.values()) {
          if (helper.is(error)) {
            const err = error as { name?: unknown; data?: unknown };
            const id = typeof err.name === "string" ? err.name : undefined;
            appErrorExtra = { id, data: err.data };
            break;
          }
        }
      } catch {
        // best-effort only
      }
      const logMessage = errorMessage(error);
      const displayMessage =
        appErrorExtra && error instanceof Error && error.message
          ? error.message
          : "Internal Error";
      safeLogError(logger, "exposure.task.error", {
        error: logMessage,
      });
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        jsonErrorResponse(500, displayMessage, "INTERNAL_ERROR", appErrorExtra),
        serializer,
      );
    }
  };
};
