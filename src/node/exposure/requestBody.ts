import type { IncomingMessage } from "http";

import type { Serializer } from "../../globals/resources/tunnel/serializer";
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
          return e as Error;
        }
      })();
      reject(err);
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err as Error);
    };
    const onEnd = () => {
      if (aborted) return;
      cleanup();
      resolve(Buffer.concat(chunks as readonly Uint8Array[]));
    };
    const onData = (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const cleanup = () => {
      const off = (req as any).off ?? (req as any).removeListener;
      if (typeof off === "function") {
        off.call(req, "data", onData);
        off.call(req, "end", onEnd);
        off.call(req, "error", onError as any);
        off.call(req, "aborted", onAbort as any);
      }
      signal?.removeEventListener("abort", onAbort as EventListener);
    };

    const add = ((req as any).once ?? (req as any).on)?.bind(req as any);
    add?.("data", onData);
    add?.("end", onEnd);
    add?.("error", onError as any);
    add?.("aborted", onAbort as any);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort as EventListener, {
        once: true,
      });
    }
  });
}

export async function readJsonBody<T>(
  req: IncomingMessage,
  signal?: AbortSignal,
  serializer?: Serializer,
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
      value: (serializer as Serializer).parse<T>(body.toString("utf8")),
    };
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse(400, "Invalid EJSON body", "INVALID_JSON"),
    };
  }
}
