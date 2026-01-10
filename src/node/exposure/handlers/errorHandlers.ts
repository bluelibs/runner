import type { JsonBody, JsonResponse } from "../types";

/** Sanitizes 500 errors if they are not application-defined */
export const sanitizeErrorResponse = (response: unknown): JsonResponse => {
  const asRecord =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : undefined;

  const statusRaw = asRecord?.status ?? asRecord?.statusCode;
  const status =
    typeof statusRaw === "number" && Number.isFinite(statusRaw)
      ? statusRaw
      : 500;

  const bodyRaw = asRecord?.body;
  const hasBody = bodyRaw && typeof bodyRaw === "object";
  const body = hasBody ? (bodyRaw as Record<string, unknown>) : undefined;

  const errorRaw =
    (body && typeof body.error === "object" ? body.error : undefined) ??
    (asRecord && typeof asRecord.error === "object"
      ? asRecord.error
      : undefined);

  const normalizedBody: JsonBody = ((): JsonBody => {
    if (body && typeof body.ok === "boolean") {
      return body as JsonBody;
    }
    if (errorRaw) {
      return { ok: false, error: errorRaw as Record<string, unknown> };
    }
    return {
      ok: false,
      error: { message: "Internal Error", code: "INTERNAL_ERROR" },
    };
  })();

  const sanitizedBody: JsonBody = ((): JsonBody => {
    const maybeError = (normalizedBody as { error?: unknown } | undefined)
      ?.error;
    const bodyError =
      maybeError && typeof maybeError === "object"
        ? (maybeError as Record<string, unknown>)
        : undefined;

    if (status !== 500 || !bodyError) return normalizedBody;

    // SECURITY: For 500 errors, only preserve safe fields to prevent information leakage.
    // Fields like 'stack', 'cause', or internal details must not reach the client.
    const safeError: Record<string, unknown> = {
      message: "Internal Error",
      code:
        typeof bodyError.code === "string" ? bodyError.code : "INTERNAL_ERROR",
    };

    // Preserve app error identity if present (for typed errors)
    if (typeof bodyError.id === "string") {
      safeError.id = bodyError.id;
    }

    // Preserve app error data if present (user-controlled payload from typed errors)
    if (bodyError.data !== undefined) {
      safeError.data = bodyError.data;
    }

    return {
      ok: false,
      error: safeError,
    };
  })();

  return { status, body: sanitizedBody };
};
