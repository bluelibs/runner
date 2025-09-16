import type { ServerResponse } from "http";

import type { JsonResponse } from "./types";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export const NOT_FOUND_RESPONSE = jsonErrorResponse(404, "Not Found", "NOT_FOUND");

export const METHOD_NOT_ALLOWED_RESPONSE = jsonErrorResponse(
  405,
  "Method Not Allowed",
  "METHOD_NOT_ALLOWED",
);

export function jsonOkResponse(
  data: Record<string, unknown> = {},
): JsonResponse {
  return { status: 200, body: { ok: true, ...data } };
}

export function jsonErrorResponse(
  status: number,
  message: string,
  code?: string,
): JsonResponse {
  const error: Record<string, unknown> = { message };
  if (code) {
    error.code = code;
  }
  return { status, body: { ok: false, error } };
}

export function respondJson(res: ServerResponse, response: JsonResponse): void {
  if (res.writableEnded) {
    return;
  }
  const payload = Buffer.from(JSON.stringify(response.body));
  res.statusCode = response.status;
  res.setHeader("content-type", JSON_CONTENT_TYPE);
  res.setHeader("content-length", String(payload.length));
  res.end(payload);
}
