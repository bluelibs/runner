import type { ServerResponse } from "http";

import type { SerializerLike } from "../../serializer";
import type { JsonResponse, StreamingResponse } from "./types";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export const NOT_FOUND_RESPONSE = jsonErrorResponse(
  404,
  "Not Found",
  "NOT_FOUND",
);

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
  extra?: Record<string, unknown>,
): JsonResponse {
  const error: Record<string, unknown> = { message };
  if (code) {
    error.code = code;
  }
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      error[k] = v;
    }
  }
  return { status, body: { ok: false, error } };
}

export function respondJson(
  res: ServerResponse,
  response: JsonResponse,
  serializer?: SerializerLike,
): void {
  if (res.writableEnded) {
    return;
  }
  const payload = Buffer.from(
    serializer?.stringify(response.body) ?? JSON.stringify(response.body),
    "utf8",
  );
  res.statusCode = response.status;
  res.setHeader("content-type", JSON_CONTENT_TYPE);
  res.setHeader("content-length", String(payload.length));
  res.end(payload);
}

export function respondStream(
  res: ServerResponse,
  value: StreamingResponse | NodeJS.ReadableStream,
): void {
  if (res.writableEnded) return;
  const isReadable = (v: unknown): v is NodeJS.ReadableStream =>
    !!v && typeof (v as { pipe?: unknown }).pipe === "function";
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
  const canPipe = typeof (res as unknown as { on?: unknown }).on === "function";
  if (canPipe) {
    stream.pipe(res);
    return;
  }

  const safeWrite = (payload: Buffer) => {
    (res as unknown as { write?: (chunk: Buffer) => unknown }).write?.(payload);
  };

  const safeEnd = () => {
    (res as unknown as { end?: () => unknown }).end?.();
  };

  const handleData = (chunk: unknown) => {
    const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    safeWrite(payload);
  };

  const removeDataListener = () => {
    const emitter = stream as unknown as {
      removeListener?: (
        event: string,
        handler: (...args: any[]) => void,
      ) => void;
      off?: (event: string, handler: (...args: any[]) => void) => void;
    };

    if (typeof emitter.removeListener === "function") {
      emitter.removeListener("data", handleData);
      return;
    }

    if (typeof emitter.off === "function") {
      emitter.off("data", handleData);
    }
  };

  const handleEnd = () => {
    removeDataListener();
    safeEnd();
  };

  const handleError = () => {
    removeDataListener();
    if (!res.writableEnded) safeEnd();
  };

  const read = (
    stream as unknown as { read?: (size?: number) => unknown }
  ).read?.bind(stream) as undefined | ((size?: number) => unknown);
  if (typeof read === "function") {
    let chunk: unknown;
    while ((chunk = read()) != null) {
      handleData(chunk);
    }
    const state = (stream as unknown as { _readableState?: unknown })
      ._readableState as { ended?: unknown } | undefined;
    const ended = Boolean(
      (stream as unknown as { readableEnded?: unknown }).readableEnded ||
      state?.ended,
    );
    if (ended) {
      if (!res.writableEnded) safeEnd();
      return;
    }
  }

  stream.on("data", handleData);
  stream.once("end", handleEnd);
  stream.once("error", handleError);

  const resume = (stream as unknown as { resume?: () => unknown }).resume;
  if (typeof resume === "function") {
    resume.call(stream);
  }
}
