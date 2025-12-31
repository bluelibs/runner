import type { IncomingMessage } from "http";

import type { SerializerLike } from "../../serializer";
import { jsonErrorResponse } from "./httpResponse";
import type { JsonResponse } from "./types";
import { cancellationError } from "../../errors";

export async function readRequestBody(
  req: IncomingMessage,
  signal?: AbortSignal,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let aborted = false;

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      cleanup();
      const err = (() => {
        try {
          cancellationError.throw({ reason: "Request aborted" });
        } catch (e) {
          return e instanceof Error ? e : new Error(String(e));
        }
      })();
      reject(err);
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onEnd = () => {
      if (aborted) return;
      cleanup();
      resolve(Buffer.concat(chunks as readonly Uint8Array[]));
    };
    const onData = (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const cleanup = () => {
      const emitter = req as unknown as {
        removeListener?: (
          event: string,
          handler: (...args: any[]) => void,
        ) => void;
        off?: (event: string, handler: (...args: any[]) => void) => void;
      };

      const remove = (event: string, handler: (...args: any[]) => void) => {
        if (typeof emitter.removeListener === "function") {
          emitter.removeListener(event, handler);
          return;
        }
        if (typeof emitter.off === "function") {
          emitter.off(event, handler);
        }
      };

      remove("data", onData);
      remove("end", onEnd);
      remove("error", onError);
      remove("aborted", onAbort);
      signal?.removeEventListener("abort", onAbort);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAbort);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, {
        once: true,
      });
    }
  });
}

export async function readJsonBody<T>(
  req: IncomingMessage,
  signal?: AbortSignal,
  serializer: SerializerLike,
): Promise<
  { ok: true; value: T | undefined } | { ok: false; response: JsonResponse }
> {
  const body = await readRequestBody(req, signal);
  if (body.length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    return {
      ok: true,
      value: serializer.parse<T>(body.toString("utf8")),
    };
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse(400, "Invalid JSON body", "INVALID_JSON"),
    };
  }
}
