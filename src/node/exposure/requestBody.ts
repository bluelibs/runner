import type { IncomingMessage } from "http";

import { jsonErrorResponse } from "./httpResponse";
import type { JsonResponse } from "./types";

export async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks as readonly Uint8Array[]));
    });
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("Request aborted")));
  });
}

export async function readJsonBody<T>(
  req: IncomingMessage,
): Promise<{ ok: true; value: T | undefined } | { ok: false; response: JsonResponse }> {
  const body = await readRequestBody(req);
  if (body.length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(body.toString("utf8")) as T };
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse(400, "Invalid JSON body", "INVALID_JSON"),
    };
  }
}
