import * as http from "http";
import * as https from "https";
import type { SerializerLike } from "../../serializer";
import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import type { IAsyncContext } from "../../types/asyncContext";
import { httpContextSerializationError } from "../../errors";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "../../remote-lanes/http/constants";
import { createCancellationErrorFromSignal } from "../../tools/abortSignals";
import { normalizeError } from "../../tools/normalizeError";
import type {
  HttpSmartClientAuthConfig,
  HttpSmartClientConfig,
} from "./http-smart-client.model";

type RequestModule = Pick<typeof http, "request">;

function toHeaders(auth?: HttpSmartClientAuthConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token)
    headers[(auth.header ?? "x-runner-token").toLowerCase()] = auth.token;
  return headers;
}

function mergeHeaders(
  base: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> {
  if (!extra) {
    return base;
  }
  return {
    ...base,
    ...extra,
  };
}

function buildContextHeaderOrThrow(options: {
  serializer: SerializerLike;
  contexts?: Array<IAsyncContext<unknown>>;
}): string | undefined {
  const { serializer, contexts } = options;
  if (!contexts || contexts.length === 0) return undefined;

  const map: Record<string, string> = {};
  for (const asyncContext of contexts) {
    try {
      const value = asyncContext.use();
      map[asyncContext.id] = asyncContext.serialize(value);
    } catch (error) {
      httpContextSerializationError.throw({
        contextId: asyncContext.id,
        reason: normalizeError(error).message,
      });
    }
  }

  return serializer.stringify(map);
}

function requestLib(url: URL): RequestModule {
  return url.protocol === "https:" ? https : http;
}

function toTimeoutError(
  url: string,
  timeoutMs?: number,
): RemoteLaneTransportError {
  const detail =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? ` after ${timeoutMs}ms`
      : "";
  return new RemoteLaneTransportError(
    "REQUEST_TIMEOUT",
    `Remote lane request timeout${detail}`,
    { url, timeoutMs },
    { httpCode: 408 },
  );
}

export function prepareNodeRequest(
  cfg: HttpSmartClientConfig,
  url: string,
  contentType: string,
  headersOverride?: Record<string, string>,
) {
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const headers: Record<string, string> = {
    "content-type": contentType,
    ...mergeHeaders(toHeaders(cfg.auth), headersOverride),
  };
  const contextHeader = buildContextHeaderOrThrow({
    serializer: cfg.serializer,
    contexts: cfg.contexts,
  });
  if (contextHeader) headers[RUNNER_ASYNC_CONTEXT_HEADER] = contextHeader;

  return {
    lib,
    requestOptions: {
      method: "POST",
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers,
      timeout: cfg.timeoutMs,
    },
  };
}

export function createSettledCallbacks<T>(
  resolve: (value: T) => void,
  reject: (error: unknown) => void,
) {
  let settled = false;
  const cleanup: Array<() => void> = [];
  const resolveOnce = (value: T) => {
    if (settled) return;
    settled = true;
    cleanup.forEach((fn) => fn());
    resolve(value);
  };
  // Request/response failures are normalized before reaching here; direct
  // rejections (parse, pipeline) propagate raw like the fetch client.
  const rejectOnce = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup.forEach((fn) => fn());
    reject(error);
  };

  return {
    cleanup,
    resolveOnce,
    rejectOnce,
  };
}

export function attachRequestAbort(
  req: http.ClientRequest,
  cleanup: Array<() => void>,
  signal?: AbortSignal,
): void {
  if (signal) {
    const onAbort = () =>
      req.destroy(createCancellationErrorFromSignal(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    cleanup.push(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) {
      onAbort();
    }
  }
}

export function attachRequestTimeout(
  req: http.ClientRequest,
  url: string,
  timeoutMs: number | undefined,
): () => void {
  const onTimeout = () => req.destroy(toTimeoutError(url, timeoutMs));
  req.on("timeout", onTimeout);
  return () => req.removeListener("timeout", onTimeout);
}
