import type { SerializerLike } from "./serializer";
import type { ProtocolEnvelope } from "./remote-lanes/http/protocol";
import { assertOkEnvelope } from "./remote-lanes/http/protocol";
import { createExposureFetch } from "./http-fetch-remote-lane.resource";
import { buildUniversalManifest } from "./tools/buildUniversalManifest";
import type { IAsyncContext } from "./types/asyncContext";
import type { IErrorHelper } from "./types/error";
import {
  httpBaseUrlRequiredError,
  httpClientInputUnsupportedError,
  httpContextSerializationError,
  httpEventWithResultUnavailableError,
} from "./errors";

/**
 * Bearer-style authentication configuration for the universal HTTP client.
 */
export interface HttpClientAuth {
  header?: string;
  token: string;
}

/**
 * Configuration for {@link createHttpClient}.
 *
 * The universal client is JSON-first and can upload browser `Blob`/`File` values,
 * but it does not support Node stream inputs.
 */
export interface HttpClientConfig {
  baseUrl: string;
  auth?: HttpClientAuth;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  serializer: SerializerLike;
  onRequest?: (requestContext: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

/**
 * Minimal client contract for invoking exposed tasks and events over HTTP.
 */
export interface HttpClient {
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
    options?: { headers?: Record<string, string> },
  ): Promise<O>;
  event<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string> },
  ): Promise<void>;
  eventWithResult?<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string> },
  ): Promise<P>;
}

function toHeaders(auth?: HttpClientAuth): Record<string, string> {
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

function buildContextHeaderOrThrow(
  serializer: SerializerLike,
  contexts?: Array<IAsyncContext<unknown>>,
): string | undefined {
  if (!contexts || contexts.length === 0) return undefined;

  const map: Record<string, string> = {};
  for (const asyncContext of contexts) {
    try {
      const value = asyncContext.use();
      map[asyncContext.id] = asyncContext.serialize(value);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      httpContextSerializationError.throw({
        contextId: asyncContext.id,
        reason: normalizedError.message,
      });
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

/**
 * Creates a platform-neutral HTTP client for Runner task and event exposure.
 *
 * Use this client in browser or universal code paths. When you need Node-native
 * streaming or multipart file support, switch to the Node entrypoint clients.
 *
 * The impact of choosing this client is portability: the same call site works in
 * browser-oriented environments, but raw Node streams are intentionally rejected
 * so unsupported transport behavior fails fast.
 *
 * @example
 * ```ts
 * import { Serializer, createHttpClient } from "@bluelibs/runner";
 *
 * const client = createHttpClient({
 *   baseUrl: "https://api.example.com",
 *   serializer: new Serializer(),
 * });
 *
 * const user = await client.task("getUser", { id: "u1" });
 * ```
 */
export function createHttpClient(cfg: HttpClientConfig): HttpClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) {
    httpBaseUrlRequiredError.throw({ clientFactory: "createHttpClient" });
  }

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
    headersOverride?: Record<string, string>,
  ) {
    const fd = new FormData();
    fd.append("__manifest", manifestText);
    for (const f of files) {
      const filename = f.meta?.name ?? "upload";
      fd.append(`file:${f.id}`, f.blob, filename);
    }
    const headers = mergeHeaders(toHeaders(cfg.auth), headersOverride);
    const contextHeader = buildContextHeaderOrThrow(
      cfg.serializer,
      cfg.contexts,
    );
    if (contextHeader) headers["x-runner-context"] = contextHeader;
    if (cfg.onRequest) await cfg.onRequest({ url, headers });
    const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
    const res = await fetchImpl(url, {
      method: "POST",
      body: fd,
      headers,
      // Security: prevent automatic redirects from forwarding auth headers.
      redirect: "error",
    });
    const text = await res.text();
    const json = text ? cfg.serializer.parse(text) : undefined;
    return json as ProtocolEnvelope<any>;
  }

  return {
    async task<I, O>(
      id: string,
      input?: I,
      options?: { headers?: Record<string, string> },
    ): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // Guard: raw Node Readable-like inputs are not supported in universal client
      if (isNodeReadable(input)) {
        httpClientInputUnsupportedError.throw({
          message:
            "createHttpClient (universal) cannot send a Node stream. Use @bluelibs/runner/node createHttpSmartClient or createHttpMixedClient for duplex/streaming.",
        });
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
          options?.headers,
        );
        try {
          return assertOkEnvelope<O>(r as ProtocolEnvelope<O>, {
            fallbackMessage: "Remote lane task error",
          });
        } catch (e) {
          rethrowWithRegistry(e, cfg.errorRegistry);
        }
      }

      // If Node files were detected, instruct user to use Node clients
      if (manifest.nodeFiles.length > 0) {
        httpClientInputUnsupportedError.throw({
          message:
            "createHttpClient (universal) detected Node file input. Use @bluelibs/runner/node createHttpSmartClient or createHttpMixedClient for Node streaming/multipart.",
        });
      }

      // JSON fallback
      try {
        return await fetchClient.task<I, O>(id, input as I, options);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },

    async event<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string> },
    ): Promise<void> {
      try {
        return await fetchClient.event<P>(id, payload, options);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },

    async eventWithResult<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string> },
    ): Promise<P> {
      try {
        if (!fetchClient.eventWithResult) {
          httpEventWithResultUnavailableError.throw({
            clientFactory: "createHttpClient",
          });
        }
        return await fetchClient.eventWithResult!<P>(id, payload, options);
      } catch (e) {
        rethrowWithRegistry(e, cfg.errorRegistry);
      }
    },
  };
}
