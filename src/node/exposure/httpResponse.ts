import type { ServerResponse } from "http";

import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";
import type { JsonResponse, StreamingResponse } from "./types";

export const EJSON_CONTENT_TYPE = "application/json; charset=utf-8";

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
  const payload = Buffer.from(
    getDefaultSerializer().stringify(response.body),
    "utf8",
  );
  res.statusCode = response.status;
  res.setHeader("content-type", EJSON_CONTENT_TYPE);
  res.setHeader("content-length", String(payload.length));
  res.end(payload);
}

export function respondStream(
  res: ServerResponse,
  value: StreamingResponse | NodeJS.ReadableStream,
): void {
  if (res.writableEnded) return;
  const isReadable = (v: unknown): v is NodeJS.ReadableStream =>
    !!v && typeof (v as any).pipe === "function";
  let stream: NodeJS.ReadableStream;
  let status = 200;
  let contentType = "application/octet-stream";
  let headers: Record<string, string> | undefined;
  if (isReadable(value)) {
    stream = value;
  } else {
    stream = value.stream;
    status = value.status ?? status;
    contentType = value.contentType ?? contentType;
    headers = value.headers;
  }
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  }
  // Some unit tests stub `res` without full stream interface (no `.on`).
  // Prefer pipe when destination looks like a Writable stream, otherwise manually forward chunks.
  const canPipe = typeof (res as any).on === "function";
  if (canPipe) {
    stream.pipe(res as any);
    return;
  }

  const handleData = (chunk: unknown) => {
    const payload = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk));
    (res as any).write?.(payload);
  };

  const removeDataListener = () => {
    const off = (stream as any).off ?? (stream as any).removeListener;
    if (typeof off === "function") {
      off.call(stream, "data", handleData);
    }
  };

  const handleEnd = () => {
    removeDataListener();
    (res as any).end?.();
  };

  const handleError = () => {
    removeDataListener();
    if (!res.writableEnded) (res as any).end?.();
  };

  const read = (stream as any).read?.bind(stream) as
    | undefined
    | ((size?: number) => unknown);
  if (typeof read === "function") {
    let chunk: unknown;
    while ((chunk = read()) != null) {
      handleData(chunk);
    }
    const state: any = (stream as any)._readableState;
    const ended = !!((stream as any).readableEnded || (state && state.ended));
    if (ended) {
      if (!res.writableEnded) (res as any).end?.();
      return;
    }
  }

  stream.on("data", handleData);
  stream.once("end", handleEnd);
  stream.once("error", handleError);

  const resume = (stream as any).resume;
  if (typeof resume === "function") {
    resume.call(stream);
  }
}
