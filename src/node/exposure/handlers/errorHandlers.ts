import type { IncomingMessage, ServerResponse } from "http";

import type { SerializerLike } from "../../../serializer";
import type { Logger } from "../../../models/Logger";
import type { Store } from "../../../models/Store";
import type { NodeExposureHttpCorsConfig } from "../resourceTypes";
import { applyCorsActual } from "../cors";
import { jsonErrorResponse, respondJson } from "../httpResponse";
import { errorMessage, safeLogError } from "../logging";
import type { JsonBody, JsonResponse } from "../types";

enum ExposureErrorCode {
  InternalError = "INTERNAL_ERROR",
}

enum ExposureErrorMessage {
  InternalError = "Internal Error",
}

enum ExposureErrorField {
  Name = "name",
  Message = "message",
  Code = "code",
  HttpCode = "httpCode",
  Id = "id",
  Data = "data",
  Stack = "stack",
  Cause = "cause",
  Sql = "sql",
}

export enum ExposureErrorLogKey {
  TaskError = "exposure.task.error",
  EventError = "exposure.event.error",
}

const UNSAFE_ERROR_FIELDS = new Set<string>([
  ExposureErrorField.Stack,
  ExposureErrorField.Cause,
  ExposureErrorField.Sql,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isJsonBody = (value: unknown): value is JsonBody =>
  isRecord(value) && typeof value.ok === "boolean";

const toErrorRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const isValidHttpCode = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 599;

/** Sanitizes 500 errors if they are not application-defined */
export const sanitizeErrorResponse = (response: unknown): JsonResponse => {
  const asRecord = isRecord(response) ? response : undefined;

  const statusRaw = asRecord?.status ?? asRecord?.statusCode;
  const status =
    typeof statusRaw === "number" && Number.isFinite(statusRaw)
      ? statusRaw
      : 500;

  const bodyRaw = asRecord?.body;
  const body = isRecord(bodyRaw) ? bodyRaw : undefined;

  const errorRaw =
    (body ? toErrorRecord(body.error) : undefined) ??
    toErrorRecord(asRecord?.error);

  const normalizedBody: JsonBody = ((): JsonBody => {
    if (isJsonBody(bodyRaw)) {
      return bodyRaw;
    }
    if (errorRaw) {
      return { ok: false, error: errorRaw };
    }
    return {
      ok: false,
      error: {
        message: ExposureErrorMessage.InternalError,
        code: ExposureErrorCode.InternalError,
      },
    };
  })();

  const sanitizedBody: JsonBody = ((): JsonBody => {
    if (normalizedBody.ok) return normalizedBody;

    const bodyError = toErrorRecord(
      (normalizedBody as { error?: unknown }).error,
    );

    if (!bodyError) return normalizedBody;

    if (status === 500) {
      // SECURITY: For 500 errors, only preserve safe fields to prevent information leakage.
      // Fields like 'stack', 'cause', or internal details must not reach the client.
      const isTypedError = typeof bodyError.id === "string";
      const safeMessage =
        isTypedError && typeof bodyError.message === "string"
          ? bodyError.message
          : ExposureErrorMessage.InternalError;
      const safeError: Record<string, unknown> = {
        message: safeMessage,
        code:
          typeof bodyError.code === "string"
            ? bodyError.code
            : ExposureErrorCode.InternalError,
      };

      // Preserve app error identity if present (for typed errors)
      if (typeof bodyError.id === "string") {
        safeError.id = bodyError.id;
      }

      // Preserve app error data if present (user-controlled payload from typed errors)
      if (bodyError.data !== undefined) {
        safeError.data = bodyError.data;
      }

      if (isValidHttpCode(bodyError.httpCode)) {
        safeError.httpCode = bodyError.httpCode;
      }

      return {
        ok: false,
        error: safeError,
      };
    }

    const sanitizedError: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bodyError)) {
      if (UNSAFE_ERROR_FIELDS.has(key)) continue;
      sanitizedError[key] = value;
    }

    return {
      ok: false,
      error: sanitizedError,
    };
  })();

  return { status, body: sanitizedBody };
};

export interface HandleRequestErrorOptions {
  error: unknown;
  req: IncomingMessage;
  res: ServerResponse;
  store: Store;
  logger: Logger;
  cors?: NodeExposureHttpCorsConfig;
  serializer: SerializerLike;
  logKey: ExposureErrorLogKey;
}

interface AppErrorExtra extends Record<string, unknown> {
  id?: string;
  data?: unknown;
  httpCode?: number;
}

const resolveAppErrorExtra = (
  store: Store,
  error: unknown,
): AppErrorExtra | undefined => {
  try {
    for (const helper of store.errors.values()) {
      if (helper.is(error)) {
        if (!isRecord(error)) {
          return {
            id: undefined,
            data: undefined,
            httpCode: isValidHttpCode(helper.httpCode)
              ? helper.httpCode
              : undefined,
          };
        }

        const name = error[ExposureErrorField.Name];
        const id = typeof name === "string" ? name : undefined;
        const data = error[ExposureErrorField.Data];
        const runtimeHttpCode = error[ExposureErrorField.HttpCode];
        const httpCode = isValidHttpCode(runtimeHttpCode)
          ? runtimeHttpCode
          : isValidHttpCode(helper.httpCode)
            ? helper.httpCode
            : undefined;
        return { id, data, httpCode };
      }
    }
  } catch {
    // best-effort only
  }
  return undefined;
};

export const handleRequestError = (
  options: HandleRequestErrorOptions,
): void => {
  const { error, req, res, store, logger, cors, serializer, logKey } = options;
  const appErrorExtra = resolveAppErrorExtra(store, error);
  const responseStatus = appErrorExtra?.httpCode ?? 500;
  const displayMessage =
    appErrorExtra && error instanceof Error && error.message
      ? error.message
      : ExposureErrorMessage.InternalError;
  safeLogError(logger, logKey, { error: errorMessage(error) });
  applyCorsActual(req, res, cors);
  respondJson(
    res,
    sanitizeErrorResponse(
      jsonErrorResponse(
        responseStatus,
        displayMessage,
        ExposureErrorCode.InternalError,
        appErrorExtra,
      ),
    ),
    serializer,
  );
};
