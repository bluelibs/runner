import type * as http from "http";
import { pipeline, type Readable } from "stream";
import type { SerializerLike } from "../../serializer";
import {
  RemoteLaneTransportError,
  toRequestRejectionError,
} from "../../remote-lanes/http/protocol";
import type { buildNodeManifest } from "../upload/manifest";
import { parseRetryAfterMs } from "../../remote-lanes/http/retryAfter";
import { encodeMultipart } from "./http-smart-client.multipart";
import type { HttpSmartClientConfig } from "./http-smart-client.model";
import {
  attachRequestAbort,
  attachRequestTimeout,
  createSettledCallbacks,
  prepareNodeRequest,
} from "./http-smart-client.request";

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
  let totalBytes = 0;
  const statusCode = res.statusCode ?? 0;

  res.on("data", (c: unknown) => {
    const chunk = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    totalBytes += chunk.length;
    chunks.push(chunk);
  });
  res.on("end", () => {
    const text =
      chunks.length === 1
        ? chunks[0].toString("utf8")
        : Buffer.concat(chunks as readonly Uint8Array[], totalBytes).toString(
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
  preSerializedBody?: string,
): Promise<T> {
  const serializer = cfg.serializer;
  const { lib, requestOptions } = prepareNodeRequest(
    cfg,
    url,
    "application/json; charset=utf-8",
    headersOverride,
  );
  const payload = Buffer.from(
    preSerializedBody ?? serializer.stringify(body),
    "utf8",
  );
  if (cfg.onRequest) {
    await cfg.onRequest({ url, headers: requestOptions.headers });
  }

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
    attachRequestAbort(req, cleanup, signal);
    cleanup.push(attachRequestTimeout(req, url, cfg.timeoutMs));
    req.end(payload);
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
  const { lib, requestOptions } = prepareNodeRequest(
    cfg,
    url,
    `multipart/form-data; boundary=${boundary}`,
    headersOverride,
  );
  if (cfg.onRequest) {
    await cfg.onRequest({ url, headers: requestOptions.headers });
  }

  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      const { cleanup, resolveOnce, rejectOnce } = createSettledCallbacks(
        resolve,
        reject,
      );
      const req = lib.request(requestOptions, (res) =>
        resolveOnce({ stream: res, res }),
      );
      req.on("error", (error) =>
        rejectOnce(toRequestRejectionError(error, signal?.aborted ?? false)),
      );
      attachRequestAbort(req, cleanup, signal);
      // Resolving with headers hands the response body to the caller.
      req.once("close", attachRequestTimeout(req, url, cfg.timeoutMs));
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
  const { lib, requestOptions } = prepareNodeRequest(
    cfg,
    url,
    "application/octet-stream",
    headersOverride,
  );

  let sourceFailure: { error: unknown } | undefined;
  const onSourceError = (error: unknown) => {
    sourceFailure = { error };
  };
  // The source may fail while an asynchronous request hook is running.
  stream.once("error", onSourceError);
  try {
    if (cfg.onRequest) {
      await cfg.onRequest({ url, headers: requestOptions.headers });
    }
    if (sourceFailure) throw sourceFailure.error;

    return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
      (resolve, reject) => {
        const { cleanup, resolveOnce, rejectOnce } = createSettledCallbacks(
          resolve,
          reject,
        );

        const req = lib.request(requestOptions, (res) => {
          // Defer resolution to the next check/timer turn to allow
          // any immediate source errors (propagated via req.destroy)
          // to reject the promise first.
          setImmediate(() => resolveOnce({ stream: res, res }));
        });

        const onReqError = (error: unknown) =>
          rejectOnce(
            sourceFailure
              ? sourceFailure.error
              : toRequestRejectionError(error, signal?.aborted ?? false),
          );
        req.on("error", onReqError);
        cleanup.push(() => req.removeListener("error", onReqError));
        attachRequestAbort(req, cleanup, signal);
        cleanup.push(attachRequestTimeout(req, url, cfg.timeoutMs));

        // Use pipeline to safely wire errors between source and request,
        // preventing unhandled 'error' on the source stream.
        const onPipelineDone = (err?: NodeJS.ErrnoException | null) => {
          if (err) rejectOnce(sourceFailure ? sourceFailure.error : err);
        };
        pipeline(stream, req, onPipelineDone);
      },
    );
  } finally {
    stream.removeListener("error", onSourceError);
  }
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
