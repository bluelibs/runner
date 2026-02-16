import type { SerializerLike } from "./serializer";
import type { ProtocolEnvelope } from "./globals/resources/tunnel/protocol";
import { assertOkEnvelope } from "./globals/resources/tunnel/protocol";
import { createExposureFetch } from "./http-fetch-tunnel.resource";
import { buildUniversalManifest } from "./tools/buildUniversalManifest";
import type { IAsyncContext } from "./types/asyncContext";
import type { IErrorHelper } from "./types/error";

export interface HttpClientAuth {
  header?: string;
  token: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  auth?: HttpClientAuth;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  serializer: SerializerLike;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

export interface HttpClient {
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
  eventWithResult?<P = unknown>(id: string, payload?: P): Promise<P>;
}

function toHeaders(auth?: HttpClientAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token)
    headers[(auth.header ?? "x-runner-token").toLowerCase()] = auth.token;
  return headers;
}

function buildContextHeaderOrThrow(
  serializer: SerializerLike,
  contexts?: Array<IAsyncContext<unknown>>,
): string | undefined {
  if (!contexts || contexts.length === 0) return undefined;

  const map: Record<string, string> = {};
  for (const ctx of contexts) {
    try {
      const value = ctx.use();
      map[ctx.id] = ctx.serialize(value);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      throw new Error(
        `Failed to serialize async context "${ctx.id}" for HTTP request: ${normalizedError.message}`,
      );
    }
  }

  return serializer.stringify(map);
}

/**
 * Re-throws the caught error. When an error registry is configured,
 * checks for a matching typed-error helper and re-throws via that helper first.
 */
function rethrowWithRegistry(
  e: unknown,
  errorRegistry: Map<string, IErrorHelper<any>> | undefined,
): never {
  const te = e as { id?: unknown; data?: unknown; name?: unknown };
  if (errorRegistry && te.id && te.data) {
    const id = String(te.id);
    // Idempotency: if the error already looks like a typed Runner error
    // from this registry, do not remap it again.
    if (te.name === id && errorRegistry.has(id)) {
      throw e;
    }
    const helper = errorRegistry.get(id);
    if (helper) helper.throw(te.data);
  }
  throw e;
}

export function createHttpClient(cfg: HttpClientConfig): HttpClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) throw new Error("createHttpClient requires baseUrl");

  const isNodeReadable = (
    value: unknown,
  ): value is { pipe: (...args: unknown[]) => unknown } =>
    !!value && typeof (value as { pipe?: unknown }).pipe === "function";

  const fetchClient = createExposureFetch({
    baseUrl,
    auth: cfg.auth,
    timeoutMs: cfg.timeoutMs,
    fetchImpl: cfg.fetchImpl,
    serializer: cfg.serializer,
    onRequest: cfg.onRequest,
    contexts: cfg.contexts,
    errorRegistry: cfg.errorRegistry,
  });

  async function postMultipartBrowser(
    url: string,
    manifestText: string,
    files: ReturnType<typeof buildUniversalManifest>["webFiles"],
  ) {
    const fd = new FormData();
    fd.append("__manifest", manifestText);
    for (const f of files) {
      const filename = f.meta?.name ?? "upload";
      fd.append(`file:${f.id}`, f.blob as unknown as Blob, filename);
    }
    const headers = toHeaders(cfg.auth);
    const contextHeader = buildContextHeaderOrThrow(
      cfg.serializer,
      cfg.contexts,
    );
    if (contextHeader) headers["x-runner-context"] = contextHeader;
    if (cfg.onRequest) await cfg.onRequest({ url, headers });
    const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
    const res = await fetchImpl(url, { method: "POST", body: fd, headers });
    const text = await res.text();
    const json = text ? cfg.serializer.parse(text) : undefined;
    return json as ProtocolEnvelope<any>;
  }

  return {
    async task<I, O>(id: string, input?: I): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // Guard: raw Node Readable-like inputs are not supported in universal client
      if (isNodeReadable(input)) {
        throw new Error(
          "createHttpClient (universal) cannot send a Node stream. Use @bluelibs/runner/node createHttpSmartClient or createHttpMixedClient for duplex/streaming.",
        );
      }

      // Multipart path: browser files only (FormData). Node files are not supported here.
      const manifest = buildUniversalManifest(input);
      if (manifest.webFiles.length > 0) {
        const manifestText = cfg.serializer.stringify({
          input: manifest.input,
        });
        const r = await postMultipartBrowser(
          url,
          manifestText,
          manifest.webFiles,
        );
        try {
          return assertOkEnvelope<O>(r as ProtocolEnvelope<O>, {
            fallbackMessage: "Tunnel task error",
          });
        } catch (e) {
          rethrowWithRegistry(e, cfg.errorRegistry);
        }
      }

      // If Node files were detected, instruct user to use Node clients
      if (manifest.nodeFiles.length > 0) {
        throw new Error(
          "createHttpClient (universal) detected Node file input. Use @bluelibs/runner/node createHttpSmartClient or createHttpMixedClient for Node streaming/multipart.",
        );
      }

      // JSON fallback
      try {
        return await fetchClient.task<I, O>(id, input as I);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },

    async event<P>(id: string, payload?: P): Promise<void> {
      try {
        return await fetchClient.event<P>(id, payload);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },

    async eventWithResult<P>(id: string, payload?: P): Promise<P> {
      try {
        if (!fetchClient.eventWithResult) {
          throw new Error(
            "createHttpClient: eventWithResult not available on underlying tunnel client.",
          );
        }
        return await fetchClient.eventWithResult<P>(id, payload);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },
  };
}
