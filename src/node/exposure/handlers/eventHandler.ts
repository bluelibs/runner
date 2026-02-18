import type { IncomingMessage, ServerResponse } from "http";
import {
  jsonErrorResponse,
  jsonOkResponse,
  METHOD_NOT_ALLOWED_RESPONSE,
  respondJson,
} from "../httpResponse";
import { readJsonBody } from "../requestBody";
import type { SerializerLike } from "../../../serializer";
import type { Authenticator, AllowListGuard } from "../types";
import type {
  NodeExposureDeps,
  NodeExposureHttpCorsConfig,
} from "../resourceTypes";
import { cancellationError } from "../../../errors";
import { applyCorsActual } from "../cors";
import { createAbortControllerForRequest } from "../utils";
import { withUserContexts } from "./contextWrapper";
import { ExposureErrorLogKey, handleRequestError } from "./errorHandlers";
import { getRequestId } from "../requestIdentity";

interface EventHandlerDeps {
  store: NodeExposureDeps["store"];
  eventManager: NodeExposureDeps["eventManager"];
  logger: NodeExposureDeps["logger"];
  authenticator: Authenticator;
  allowList: AllowListGuard;
  cors?: NodeExposureHttpCorsConfig;
  serializer: SerializerLike;
  limits?: {
    json?: { maxSize?: number };
  };
}

export const createEventHandler = (deps: EventHandlerDeps) => {
  const {
    store,
    eventManager,
    logger,
    authenticator,
    allowList,
    cors,
    serializer,
    limits,
  } = deps;

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    eventId: string,
  ): Promise<void> => {
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

    const allowError = allowList.ensureEvent(eventId);
    if (allowError) {
      applyCorsActual(req, res, cors);
      respondJson(res, allowError, serializer);
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
      const body = await readJsonBody<{
        payload?: unknown;
        returnPayload?: boolean;
      }>(req, controller.signal, serializer, limits?.json?.maxSize);
      if (!body.ok) {
        applyCorsActual(req, res, cors);
        respondJson(res, body.response, serializer);
        return;
      }
      const returnPayload = Boolean(body.value?.returnPayload);
      if (returnPayload && storeEvent.event.parallel) {
        applyCorsActual(req, res, cors);
        respondJson(
          res,
          jsonErrorResponse(
            400,
            `Event ${eventId} is marked parallel; returning a payload is not supported.`,
            "PARALLEL_EVENT_RETURN_UNSUPPORTED",
          ),
          serializer,
        );
        return;
      }

      // Compose user contexts; events do not need exposure req context
      const runEmit = () =>
        withUserContexts(req, { store, serializer }, async () => {
          if (returnPayload) {
            return await eventManager.emitWithResult(
              storeEvent.event,
              body.value?.payload,
              "exposure:http",
            );
          }
          await eventManager.emit(
            storeEvent.event,
            body.value?.payload,
            "exposure:http",
          );
          return undefined;
        });

      const payload = await runEmit();
      applyCorsActual(req, res, cors);
      respondJson(
        res,
        returnPayload ? jsonOkResponse({ result: payload }) : jsonOkResponse(),
        serializer,
      );
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
        logKey: ExposureErrorLogKey.EventError,
        requestId: getRequestId(req),
      });
    }
  };
};
