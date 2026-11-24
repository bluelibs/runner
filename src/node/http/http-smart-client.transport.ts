import * as http from "http";
import * as https from "https";
import { Readable, pipeline } from "stream";
import type { SerializerLike } from "../../serializer";
import {
  RemoteLaneTransportError,
  toRequestRejectionError,
} from "../../remote-lanes/http/protocol";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";
import { buildNodeManifest } from "../upload/manifest";
import { httpContextSerializationError } from "../../errors";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "../../remote-lanes/http/constants";
import { parseRetryAfterMs } from "../../remote-lanes/http/retryAfter";
import { createCancellationErrorFromSignal } from "../../tools/abortSignals";
import { normalizeError } from "../../tools/normalizeError";
import { encodeMultipart } from "./http-smart-client.multipart";
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

function toHttpStatusError(options: {
  statusCode: number;
  statusMessage?: string;
  contentType?: string;
  bodyPreview?: string;
  retryAfterMs?: number;
}): RemoteLaneTransportError {
  const { statusCode, statusMessage, contentType, bodyPreview } = options;
  const message = statusMessage
    ? `Remote lane HTTP ${statusCode} ${statusMessage}`
    : `Remote lane HTTP ${statusCode}`;
  return new RemoteLaneTransportError(
    "HTTP_ERROR",
    message,
    {
      statusCode,
      statusMessage,
      contentType,
      bodyPreview,
    },
    { httpCode: statusCode, retryAfterMs: options.retryAfterMs },
  );
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

async function prepareNodeRequest(
  cfg: HttpSmartClientConfig,
  url: string,
  contentType: string,
  headersOverride?: Record<string, string>,
): Promise<{
  lib: RequestModule;
  requestOptions: http.RequestOptions;
}> {
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
  if (cfg.onRequest) await cfg.onRequest({ url, headers });

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

function createSettledCallbacks<T>(
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
    isSettled: () => settled,
    resolveOnce,
    rejectOnce,
  };
}

function attachAbortAndTimeout(
  req: http.ClientRequest,
  cleanup: Array<() => void>,
  url: string,
  timeoutMs: number | undefined,
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
  const onReqTimeout = () => req.destroy(toTimeoutError(url, timeoutMs));
  req.on("timeout", onReqTimeout);
  cleanup.push(() => req.removeListener("timeout", onReqTimeout));
}

function readJsonResponseBody<T>(params: {
  res: http.IncomingMessage;
  serializer: SerializerLike;
  contentType: string;
  onResolve: (value: T) => void;
  onReject: (error: unknown) => void;
  onResponseError: (error: unknown) => void;
}): void {
  const { res, serializer, contentType, onResolve, onReject, onResponseError } =
    params;
  const chunks: Buffer[] = [];
  const statusCode = res.statusCode ?? 0;

  res.on("data", (c: unknown) => {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  });
  res.on("end", () => {
    const text = Buffer.concat(chunks as readonly Uint8Array[]).toString(
      "utf8",
    );
    if (!text) {
      if (statusCode >= 400) {
        onReject(
          toHttpStatusError({
            statusCode,
            retryAfterMs: parseRetryAfterMs(res.headers["retry-after"]),
            statusMessage: res.statusMessage,
            contentType,
          }),
        );
        return;
      }
      onResolve(undefined as T);
      return;
    }

    try {
      onResolve(serializer.parse(text) as T);
    } catch (error) {
      if (statusCode >= 400) {
        onReject(
          toHttpStatusError({
            statusCode,
            retryAfterMs: parseRetryAfterMs(res.headers["retry-after"]),
            statusMessage: res.statusMessage,
            contentType,
            bodyPreview: text.slice(0, 512),
          }),
        );
        return;
      }
      onReject(error);
    }
  });
  res.on("error", onResponseError);
}

export async function postJson<T = any>(
  cfg: HttpSmartClientConfig,
  url: string,
  body: unknown,
  headersOverride?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const serializer = cfg.serializer;
  const { lib, requestOptions } = await prepareNodeRequest(
    cfg,
    url,
    "application/json; charset=utf-8",
    headersOverride,
  );

  return await new Promise<T>((resolve, reject) => {
    const { cleanup, resolveOnce, rejectOnce } = createSettledCallbacks(
      resolve,
      reject,
    );
    const req = lib.request(requestOptions, (res) => {
      readJsonResponseBody({
        res,
        serializer,
        contentType: String(res.headers["content-type"] ?? ""),
        onResolve: resolveOnce,
        onReject: rejectOnce,
        onResponseError: (error) =>
          rejectOnce(toRequestRejectionError(error, signal?.aborted ?? false)),
      });
    });

    req.on("error", (error) =>
      rejectOnce(toRequestRejectionError(error, signal?.aborted ?? false)),
    );
    attachAbortAndTimeout(req, cleanup, url, cfg.timeoutMs, signal);
    req.write(serializer.stringify(body));
    req.end();
  });
}

export async function postMultipart(
  cfg: HttpSmartClientConfig,
  url: string,
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
  headersOverride?: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  const boundary = `runner-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const body = encodeMultipart(manifestText, files, boundary);
  const { lib, requestOptions } = await prepareNodeRequest(
    cfg,
    url,
    `multipart/form-data; boundary=${boundary}`,
    headersOverride,
  );

  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      const { cleanup, resolveOnce, rejectOnce } = createSettledCallbacks(
        resolve,
        reject,
      );
      const req = lib.request(requestOptions, (res) =>
        resolveOnce({ stream: res as Readable, res }),
      );
      req.on("error", (error) =>
        rejectOnce(toRequestRejectionError(error, signal?.aborted ?? false)),
      );
      attachAbortAndTimeout(req, cleanup, url, cfg.timeoutMs, signal);
      // Upload-body failures are not network failures: reject them raw instead
      // of routing through the request normalizer, and destroy bare so no
      // 'error' event double-reports them.
      body.on("error", (e) => {
        req.destroy();
        rejectOnce(e);
      });
      body.pipe(req);
    },
  );
}

export async function postOctetStream(
  cfg: HttpSmartClientConfig,
  url: string,
  stream: Readable,
  headersOverride?: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  const { lib, requestOptions } = await prepareNodeRequest(
    cfg,
    url,
    "application/octet-stream",
    headersOverride,
  );

  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      const { cleanup, isSettled, resolveOnce, rejectOnce } =
        createSettledCallbacks(resolve, reject);

      const req = lib.request(requestOptions, (res) => {
        // Defer resolution to the next check/timer turn to allow
        // any immediate source errors (propagated via req.destroy)
        // to reject the promise first.
        setImmediate(() => {
          if (!isSettled()) resolveOnce({ stream: res as Readable, res });
        });
      });

      let sourceFailure: { error: unknown } | undefined;
      const onSourceError = (error: unknown) => {
        sourceFailure = { error };
      };
      stream.once("error", onSourceError);
      cleanup.push(() => stream.removeListener("error", onSourceError));

      const onReqError = (error: unknown) =>
        rejectOnce(
          sourceFailure
            ? sourceFailure.error
            : toRequestRejectionError(error, signal?.aborted ?? false),
        );
      req.on("error", onReqError);
      cleanup.push(() => req.removeListener("error", onReqError));
      attachAbortAndTimeout(req, cleanup, url, cfg.timeoutMs, signal);

      // Use pipeline to safely wire errors between source and request,
      // preventing unhandled 'error' on the source stream.
      const onPipelineDone = (err?: NodeJS.ErrnoException | null) => {
        if (err) rejectOnce(sourceFailure ? sourceFailure.error : err);
      };
      pipeline(stream, req, onPipelineDone);
    },
  );
}

export function parseMaybeJsonResponse<T = any>(
  res: http.IncomingMessage,
  serializer: SerializerLike,
): Promise<T | Readable> {
  const contentType = String(res.headers["content-type"]);
  const statusCode = res.statusCode ?? 0;
  if (/^application\/json/i.test(contentType)) {
    return new Promise<T>((resolve, reject) => {
      readJsonResponseBody({
        res,
        serializer,
        contentType,
        onResolve: resolve,
        onReject: reject,
        onResponseError: reject,
      });
    });
  }
  if (statusCode >= 400) {
    if (typeof (res as { resume?: () => void }).resume === "function") {
      (res as { resume: () => void }).resume();
    }
    return Promise.reject(
      toHttpStatusError({
        statusCode,
        retryAfterMs: parseRetryAfterMs(res.headers["retry-after"]),
        statusMessage: res.statusMessage,
        contentType,
      }),
    );
  }
  return Promise.resolve(res as Readable);
}

export function rethrowTyped(
  registry: Map<string, IErrorHelper<any>> | undefined,
  error: unknown,
): never {
  if (registry && error && typeof error === "object") {
    const err = error as { id?: unknown; data?: unknown };
    if (err.id && err.data) {
      const helper = registry.get(String(err.id));
      if (helper) helper.throw(err.data);
    }
  }
  throw error;
}
