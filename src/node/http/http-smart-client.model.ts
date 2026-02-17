import * as http from "http";
import * as https from "https";
import { Readable, pipeline } from "stream";
import type { SerializerLike } from "../../serializer";
import type { ProtocolEnvelope } from "../../globals/resources/tunnel/protocol";
import {
  assertOkEnvelope,
  TunnelError,
} from "../../globals/resources/tunnel/protocol";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";
// Avoid `.node` bare import which triggers tsup native addon resolver
import { buildNodeManifest } from "../upload/manifest";
import {
  httpBaseUrlRequiredError,
  httpContextSerializationError,
} from "../../errors";

export interface HttpSmartClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface HttpSmartClientConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: HttpSmartClientAuthConfig;
  timeoutMs?: number; // optional request timeout for JSON/multipart
  serializer: SerializerLike;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

export interface HttpSmartClient {
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O | Readable>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
  eventWithResult?<P = unknown>(id: string, payload?: P): Promise<P>;
}

function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as { pipe?: unknown }).pipe === "function";
}

function hasNodeFile(value: unknown): boolean {
  const isNodeFileSentinel = (
    v: unknown,
  ): v is {
    $runnerFile: "File";
    id: string;
    _node?: { stream?: unknown; buffer?: unknown };
  } => {
    if (!v || typeof v !== "object") return false;
    const rec = v as Record<string, unknown>;
    if (rec.$runnerFile !== "File") return false;
    if (typeof rec.id !== "string") return false;
    const node = rec._node;
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    return Boolean(n.stream || n.buffer);
  };

  const visit = (v: unknown): boolean => {
    if (isNodeFileSentinel(v)) return true;
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(visit);
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (visit((v as Record<string, unknown>)[k])) return true;
    }
    return false;
  };
  return visit(value);
}

function toHeaders(auth?: HttpSmartClientAuthConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token)
    headers[(auth.header ?? "x-runner-token").toLowerCase()] = auth.token;
  return headers;
}

function buildContextHeaderOrThrow(options: {
  serializer: SerializerLike;
  contexts?: Array<IAsyncContext<unknown>>;
}): string | undefined {
  const { serializer, contexts } = options;
  if (!contexts || contexts.length === 0) return undefined;

  const map: Record<string, string> = {};
  for (const ctx of contexts) {
    try {
      const value = ctx.use();
      map[ctx.id] = ctx.serialize(value);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      httpContextSerializationError.throw({
        contextId: ctx.id,
        reason: normalizedError.message,
      });
    }
  }

  return serializer.stringify(map);
}

function requestLib(url: URL): typeof http {
  return url.protocol === "https:" ? (https as unknown as typeof http) : http;
}

function toHttpStatusError(options: {
  statusCode: number;
  statusMessage?: string;
  contentType?: string;
  bodyPreview?: string;
}): TunnelError {
  const { statusCode, statusMessage, contentType, bodyPreview } = options;
  const message = statusMessage
    ? `Tunnel HTTP ${statusCode} ${statusMessage}`
    : `Tunnel HTTP ${statusCode}`;
  return new TunnelError(
    "HTTP_ERROR",
    message,
    {
      statusCode,
      statusMessage,
      contentType,
      bodyPreview,
    },
    { httpCode: statusCode },
  );
}

function toTimeoutError(url: string, timeoutMs?: number): TunnelError {
  const detail =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? ` after ${timeoutMs}ms`
      : "";
  return new TunnelError(
    "REQUEST_TIMEOUT",
    `Tunnel request timeout${detail}`,
    { url, timeoutMs },
    { httpCode: 408 },
  );
}

async function postJson<T = any>(
  cfg: HttpSmartClientConfig,
  url: string,
  body: unknown,
): Promise<T> {
  const serializer = cfg.serializer;
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...toHeaders(cfg.auth),
  } as Record<string, string>;
  const contextHeader = buildContextHeaderOrThrow({
    serializer: cfg.serializer,
    contexts: cfg.contexts,
  });
  if (contextHeader) headers["x-runner-context"] = contextHeader;
  if (cfg.onRequest) await cfg.onRequest({ url, headers });
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const req = lib.request(
      {
        method: "POST",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: cfg.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: unknown) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks as readonly Uint8Array[]).toString(
            "utf8",
          );
          const statusCode = res.statusCode ?? 0;
          if (!text) {
            if (statusCode >= 400) {
              rejectOnce(
                toHttpStatusError({
                  statusCode,
                  statusMessage: res.statusMessage,
                  contentType: String(res.headers["content-type"] ?? ""),
                }),
              );
              return;
            }
            resolveOnce(undefined as unknown as T);
            return;
          }
          try {
            const json = serializer.parse(text) as T;
            resolveOnce(json);
          } catch (error) {
            if (statusCode >= 400) {
              rejectOnce(
                toHttpStatusError({
                  statusCode,
                  statusMessage: res.statusMessage,
                  contentType: String(res.headers["content-type"] ?? ""),
                  bodyPreview: text.slice(0, 512),
                }),
              );
              return;
            }
            rejectOnce(error);
          }
        });
        res.on("error", rejectOnce);
      },
    );
    req.on("error", rejectOnce);
    req.on("timeout", () => {
      req.destroy(toTimeoutError(url, cfg.timeoutMs));
    });
    req.write(serializer.stringify(body));
    req.end();
  });
}

function escapeHeaderValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function encodeMultipart(
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
  boundary: string,
): Readable {
  async function* gen(): AsyncGenerator<Buffer> {
    const CRLF = "\r\n";
    const boundaryLine = `--${boundary}`;

    const partHeader = (
      name: string,
      options?: { headers?: Record<string, string>; filename?: string },
    ) => {
      const h: string[] = [boundaryLine + CRLF];
      const cd: string[] = [
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"`,
      ];
      if (options?.filename) {
        cd.push(`; filename="${escapeHeaderValue(options.filename)}"`);
      }
      h.push(cd.join("") + CRLF);
      if (options?.headers) {
        for (const k of Object.keys(options.headers)) {
          h.push(`${k}: ${options.headers[k]}` + CRLF);
        }
      }
      h.push(CRLF);
      return Buffer.from(h.join(""), "utf8");
    };

    // __manifest field
    yield partHeader("__manifest");
    yield Buffer.from(manifestText, "utf8");
    yield Buffer.from(CRLF, "utf8");

    for (const entry of files) {
      const filename = entry.meta?.name ?? "upload";
      const contentType = entry.meta?.type ?? "application/octet-stream";
      const headers: Record<string, string> = {
        "Content-Type": contentType,
      };
      yield partHeader(`file:${entry.id}`, { headers, filename });
      if (entry.source.type === "buffer") {
        yield entry.source.buffer;
      } else {
        for await (const chunk of entry.source.stream) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        }
      }
      yield Buffer.from(CRLF, "utf8");
    }
    // Closing boundary
    yield Buffer.from(boundaryLine + "--" + CRLF, "utf8");
  }
  return Readable.from(gen());
}

async function postMultipart(
  cfg: HttpSmartClientConfig,
  url: string,
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const boundary = `runner-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const body = encodeMultipart(manifestText, files, boundary);
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    ...toHeaders(cfg.auth),
  };
  const contextHeader = buildContextHeaderOrThrow({
    serializer: cfg.serializer,
    contexts: cfg.contexts,
  });
  if (contextHeader) headers["x-runner-context"] = contextHeader;
  if (cfg.onRequest) await cfg.onRequest({ url, headers });

  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      let settled = false;
      const resolveOnce = (value: {
        stream: Readable;
        res: http.IncomingMessage;
      }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const req = lib.request(
        {
          method: "POST",
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          headers,
          timeout: cfg.timeoutMs,
        },
        (res) => resolveOnce({ stream: res as unknown as Readable, res }),
      );
      req.on("error", rejectOnce);
      req.on("timeout", () => {
        req.destroy(toTimeoutError(url, cfg.timeoutMs));
      });
      body.on("error", (e) => req.destroy(e as Error));
      body.pipe(req);
    },
  );
}

async function postOctetStream(
  cfg: HttpSmartClientConfig,
  url: string,
  stream: Readable,
): Promise<{ stream: Readable; res: http.IncomingMessage }> {
  const parsed = new URL(url);
  const lib = requestLib(parsed);
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    ...toHeaders(cfg.auth),
  };
  const contextHeader = buildContextHeaderOrThrow({
    serializer: cfg.serializer,
    contexts: cfg.contexts,
  });
  if (contextHeader) headers["x-runner-context"] = contextHeader;
  if (cfg.onRequest) await cfg.onRequest({ url, headers });
  return await new Promise<{ stream: Readable; res: http.IncomingMessage }>(
    (resolve, reject) => {
      let settled = false;
      const cleanup: Array<() => void> = [];

      const resolveOnce = (value: {
        stream: Readable;
        res: http.IncomingMessage;
      }) => {
        settled = true;
        cleanup.forEach((fn) => fn());
        resolve(value);
      };
      const rejectOnce = (error: unknown) => {
        settled = true;
        cleanup.forEach((fn) => fn());
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const req = lib.request(
        {
          method: "POST",
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          headers,
          timeout: cfg.timeoutMs,
        },
        (res) => {
          // Defer resolution to the next check/timer turn to allow
          // any immediate source errors (propagated via req.destroy)
          // to reject the promise first.
          setImmediate(() => {
            if (!settled)
              resolveOnce({ stream: res as unknown as Readable, res });
          });
        },
      );

      const onReqError = (e: unknown) => rejectOnce(e);
      req.on("error", onReqError);
      cleanup.push(() => req.removeListener("error", onReqError));
      const onReqTimeout = () =>
        req.destroy(toTimeoutError(url, cfg.timeoutMs));
      req.on("timeout", onReqTimeout);
      cleanup.push(() => req.removeListener("timeout", onReqTimeout));

      // Use pipeline to safely wire errors between source and request,
      // preventing unhandled 'error' on the source stream.
      const onPipelineDone = (err?: NodeJS.ErrnoException | null) => {
        if (err) rejectOnce(err);
      };
      pipeline(stream, req, onPipelineDone);
    },
  );
}

function parseMaybeJsonResponse<T = any>(
  res: http.IncomingMessage,
  serializer: SerializerLike,
): Promise<T | Readable> {
  const contentType = String(res.headers["content-type"]);
  const statusCode = res.statusCode ?? 0;
  if (/^application\/json/i.test(contentType)) {
    const chunks: Buffer[] = [];
    return new Promise<T>((resolve, reject) => {
      res.on("data", (c: unknown) => {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks as readonly Uint8Array[]).toString(
          "utf8",
        );
        try {
          if (!text && statusCode >= 400) {
            reject(
              toHttpStatusError({
                statusCode,
                statusMessage: res.statusMessage,
                contentType,
              }),
            );
            return;
          }
          const json = text
            ? (serializer.parse(text) as T)
            : (undefined as unknown as T);
          resolve(json);
        } catch (e) {
          if (statusCode >= 400) {
            reject(
              toHttpStatusError({
                statusCode,
                statusMessage: res.statusMessage,
                contentType,
                bodyPreview: text.slice(0, 512),
              }),
            );
            return;
          }
          reject(e);
        }
      });
      res.on("error", reject);
    });
  }
  if (statusCode >= 400) {
    if (typeof (res as { resume?: () => void }).resume === "function") {
      (res as { resume: () => void }).resume();
    }
    return Promise.reject(
      toHttpStatusError({
        statusCode,
        statusMessage: res.statusMessage,
        contentType,
      }),
    );
  }
  return Promise.resolve(res as unknown as Readable);
}

function rethrowTyped(
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

export function createHttpSmartClient(
  cfg: HttpSmartClientConfig,
): HttpSmartClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) {
    httpBaseUrlRequiredError.throw({
      clientFactory: "createHttpSmartClient",
    });
  }
  const serializer = cfg.serializer;

  return {
    async task<I, O>(id: string, input?: I): Promise<O | Readable> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // A) Duplex raw-body: input itself is a Node Readable
      if (isReadable(input)) {
        const { res } = await postOctetStream(cfg, url, input);
        const maybe = await parseMaybeJsonResponse<ProtocolEnvelope<O>>(
          res,
          serializer,
        );
        if (isReadable(maybe)) return maybe;
        return assertOkEnvelope<O>(maybe as ProtocolEnvelope<O>, {
          fallbackMessage: "Tunnel task error",
        }) as O;
      }

      // B) Multipart: detect File sentinels with local Node sources
      if (hasNodeFile(input)) {
        const manifest = buildNodeManifest(input);
        const manifestText = serializer.stringify({
          input: manifest.input,
        });
        try {
          const { res } = await postMultipart(
            cfg,
            url,
            manifestText,
            manifest.files,
          );
          const maybe = await parseMaybeJsonResponse<ProtocolEnvelope<O>>(
            res,
            serializer,
          );
          if (isReadable(maybe)) return maybe; // server streamed back directly
          return assertOkEnvelope<O>(maybe as ProtocolEnvelope<O>, {
            fallbackMessage: "Tunnel task error",
          }) as O;
        } catch (error) {
          rethrowTyped(cfg.errorRegistry, error);
        }
      }

      // C) JSON fallback
      try {
        const r = await postJson<ProtocolEnvelope<O>>(cfg, url, { input });
        return assertOkEnvelope<O>(r, {
          fallbackMessage: "Tunnel task error",
        });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },

    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      try {
        const r = await postJson<ProtocolEnvelope<void>>(cfg, url, { payload });
        assertOkEnvelope<void>(r, { fallbackMessage: "Tunnel event error" });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },

    async eventWithResult<P>(id: string, payload?: P): Promise<P> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      try {
        const r = await postJson<ProtocolEnvelope<P>>(cfg, url, {
          payload,
          returnPayload: true,
        });
        if (r && typeof r === "object" && r.ok && !("result" in r)) {
          throw new TunnelError(
            "INVALID_RESPONSE",
            "Tunnel event returnPayload requested but server did not include result. Upgrade the exposure server.",
          );
        }
        return assertOkEnvelope<P>(r, {
          fallbackMessage: "Tunnel event error",
        });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },
  };
}

export type { Readable };
