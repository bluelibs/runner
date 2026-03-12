import type { IncomingMessage, ServerResponse } from "http";
import {
  jsonErrorResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  respondJson,
} from "../httpResponse";
import { isMultipart, parseMultipartInput } from "../multipart";
import { readJsonBody } from "../requestBody";
import type { SerializerLike } from "../../../serializer";
import type { Authenticator, AllowListGuard, JsonResponse } from "../types";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "../resourceTypes";
import { cancellationError } from "../../../errors";
import { applyCorsActual } from "../cors";
import { createAbortControllerForRequest, getContentType } from "../utils";
import {
  ExposureErrorLogKey,
  handleRequestError,
  sanitizeErrorResponse,
} from "./errorHandlers";
import { withExposureContext } from "./contextWrapper";
import { getRequestId } from "../requestIdentity";
import type { MultipartLimits } from "../multipart";
import { respondTaskResult } from "./taskResult";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

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
    multipart?: MultipartLimits;
  };
  allowAsyncContext?: (taskId: string) => boolean;
  resolveAsyncContextAllowList?: (
    taskId: string,
  ) => readonly string[] | undefined;
  authorizeTask?: (
    req: IncomingMessage,
    taskId: string,
  ) => Promise<JsonResponse | null> | JsonResponse | null;
  sourceResourceId?: string;
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
    allowAsyncContext = () => true,
    resolveAsyncContextAllowList = () => undefined,
    authorizeTask = () => null,
    sourceResourceId = RPC_LANES_RESOURCE_ID,
  } = deps;

  const exposureSource = store.createRuntimeSource(
    "resource",
    sourceResourceId,
  );

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    taskIdInput: string,
  ): Promise<void> => {
    const taskId = store.resolveDefinitionId(taskIdInput) ?? taskIdInput;
    const policyTaskId = store.tasks.has(taskId)
      ? store.toPublicId(taskId)
      : taskIdInput;
    const allowAsyncContextForTask = allowAsyncContext(policyTaskId);
    const asyncContextAllowListForTask =
      resolveAsyncContextAllowList(policyTaskId);

    if (req.method !== "POST") {
      applyCorsActual(req, res, cors);
      respondJson(res, METHOD_NOT_ALLOWED_RESPONSE, serializer);
      return;
    }

    const auth = await authenticator(req);
    if (!auth.ok) {
      applyCorsActual(req, res, cors);
      respondJson(res, auth.response, serializer);
      return;
    }

    const allowError = allowList.ensureTask(policyTaskId);
    if (allowError) {
      applyCorsActual(req, res, cors);
      respondJson(res, allowError, serializer);
      return;
    }

    const authzError = await authorizeTask(req, policyTaskId);
    if (authzError) {
      applyCorsActual(req, res, cors);
      respondJson(res, authzError, serializer);
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
          {
            allowAsyncContext: allowAsyncContextForTask,
            allowedAsyncContextIds: asyncContextAllowListForTask,
          },
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
            taskRunner.run(storeTask.task, multipart.value, {
              source: exposureSource,
            }),
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
        respondTaskResult(req, res, taskResult, cors, serializer);
        return;
      }

      // Raw-body streaming mode: when content-type is application/octet-stream
      // we do not pre-consume the request body and allow task to read from context.req
      if (/^application\/octet-stream(?:;|$)/i.test(contentType)) {
        const result = await runWithContext(() =>
          taskRunner.run(storeTask.task, undefined, {
            source: exposureSource,
          }),
        );
        respondTaskResult(req, res, result, cors, serializer);
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
        taskRunner.run(storeTask.task, payload, {
          source: exposureSource,
        }),
      );
      respondTaskResult(req, res, result, cors, serializer);
    } catch (error) {
      if (cancellationError.is(error)) {
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
      handleRequestError({
        error,
        req,
        res,
        store,
        logger,
        cors,
        serializer,
        logKey: ExposureErrorLogKey.TaskError,
        requestId: getRequestId(req),
      });
    }
  };
};
