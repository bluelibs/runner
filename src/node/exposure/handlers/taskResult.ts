import type { ServerResponse } from "http";
import { jsonOkResponse, respondJson, respondStream } from "../httpResponse";
import { applyCorsActual } from "../cors";
import type { SerializerLike } from "../../../serializer";
import type { NodeExposureHttpCorsConfig } from "../resourceTypes";
import type { StreamingResponse } from "../types";

const isReadableStream = (value: unknown): value is NodeJS.ReadableStream =>
  !!value && typeof (value as { pipe?: unknown }).pipe === "function";

const isStreamingResponse = (value: unknown): value is StreamingResponse =>
  !!value &&
  typeof value === "object" &&
  "stream" in value &&
  isReadableStream((value as { stream?: unknown }).stream);

export function respondTaskResult(
  req: Parameters<typeof applyCorsActual>[0],
  res: ServerResponse,
  result: unknown,
  cors: NodeExposureHttpCorsConfig | undefined,
  serializer: SerializerLike,
): void {
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
  if (res.writableEnded || res.headersSent) {
    return;
  }
  applyCorsActual(req, res, cors);
  respondJson(res, jsonOkResponse({ result }), serializer);
}
