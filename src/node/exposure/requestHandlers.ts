import type { IncomingMessage, ServerResponse } from "http";

import {
  jsonErrorResponse,
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  NOT_FOUND_RESPONSE,
  respondJson,
} from "./httpResponse";
import { isMultipart, parseMultipartInput } from "./multipart";
import { readJsonBody } from "./requestBody";
import { requestUrl, resolveTargetFromRequest } from "./router";
import { errorMessage, safeLogError } from "./logging";
import type { Authenticator, AllowListGuard, RequestHandler } from "./types";
import type { ExposureRouter } from "./router";
import type { NodeExposureDeps } from "./resourceTypes";

interface RequestProcessingDeps {
  store: NodeExposureDeps["store"];
  taskRunner: NodeExposureDeps["taskRunner"];
  eventManager: NodeExposureDeps["eventManager"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  router: ExposureRouter;
}

export interface NodeExposureRequestHandlers {
  handleTask: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleEvent: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleRequest: RequestHandler;
}

export function createRequestHandlers(
  deps: RequestProcessingDeps,
): NodeExposureRequestHandlers {
  const { store, taskRunner, eventManager, logger, authenticator, allowList, router } =
    deps;

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
      respondJson(res, auth.response);
      return;
    }

    const allowError = allowList.ensureTask(taskId);
    if (allowError) {
      respondJson(res, allowError);
      return;
    }

    const storeTask = store.tasks.get(taskId);
    if (!storeTask) {
      respondJson(
        res,
        jsonErrorResponse(404, `Task ${taskId} not found`, "NOT_FOUND"),
      );
      return;
    }

    try {
      const contentType = String(req.headers["content-type"] ?? "");
      if (isMultipart(contentType)) {
        const multipart = await parseMultipartInput(req);
        if (!multipart.ok) {
          respondJson(res, multipart.response);
          return;
        }
        const result = await taskRunner.run(storeTask.task, multipart.value);
        respondJson(res, jsonOkResponse({ result }));
        return;
      }
      const body = await readJsonBody<{ input?: unknown }>(req);
      if (!body.ok) {
        respondJson(res, body.response);
        return;
      }
      const result = await taskRunner.run(storeTask.task, body.value?.input);
      respondJson(res, jsonOkResponse({ result }));
    } catch (error) {
      const logMessage = errorMessage(error);
      const displayMessage =
        error instanceof Error && error.message ? error.message : "Internal Error";
      safeLogError(logger, "exposure.task.error", {
        error: logMessage,
      });
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
      respondJson(res, auth.response);
      return;
    }

    const allowError = allowList.ensureEvent(eventId);
    if (allowError) {
      respondJson(res, allowError);
      return;
    }

    const storeEvent = store.events.get(eventId);
    if (!storeEvent) {
      respondJson(
        res,
        jsonErrorResponse(404, `Event ${eventId} not found`, "NOT_FOUND"),
      );
      return;
    }

    try {
      const body = await readJsonBody<{ payload?: unknown }>(req);
      if (!body.ok) {
        respondJson(res, body.response);
        return;
      }
      await eventManager.emit(
        storeEvent.event,
        body.value?.payload,
        "exposure:http",
      );
      respondJson(res, jsonOkResponse());
    } catch (error) {
      const logMessage = errorMessage(error);
      const displayMessage =
        error instanceof Error && error.message ? error.message : "Internal Error";
      safeLogError(logger, "exposure.event.error", {
        error: logMessage,
      });
      respondJson(
        res,
        jsonErrorResponse(500, displayMessage, "INTERNAL_ERROR"),
      );
    }
  };

  const handleTask = async (req: IncomingMessage, res: ServerResponse) => {
    const target = resolveTargetFromRequest(req, router, "task");
    if (!target.ok) {
      respondJson(res, target.response);
      return;
    }
    await processTaskRequest(req, res, target.id);
  };

  const handleEvent = async (req: IncomingMessage, res: ServerResponse) => {
    const target = resolveTargetFromRequest(req, router, "event");
    if (!target.ok) {
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
      respondJson(res, NOT_FOUND_RESPONSE);
      return true;
    }
    if (target.kind === "task") {
      await processTaskRequest(req, res, target.id);
    } else {
      await processEventRequest(req, res, target.id);
    }
    return true;
  };

  return { handleTask, handleEvent, handleRequest };
}
