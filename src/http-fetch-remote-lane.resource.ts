import {
  assertOkEnvelope,
  type ProtocolEnvelope,
  RemoteLaneTransportError,
} from "./remote-lanes/http/protocol";
import type { SerializerLike } from "./serializer";
import type {
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./remote-lanes/http/types";
import { httpBaseUrlRequiredError, httpFetchUnavailableError } from "./errors";
import { linkAbortSignals } from "./tools/abortSignals";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "./remote-lanes/http/constants";
export { normalizeError } from "./tools/normalizeError";
export type {
  ExposureFetchAuthConfig,
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./remote-lanes/http/types";

// normalizeError is re-exported from error-utils for public API

async function postSerialized<T = any>(options: {
  fetch: typeof fetch;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  serializer: SerializerLike;
  onRequest?: (requestContext: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contextHeaderText?: string;
}): Promise<T> {
  const {
    fetch: fetchFn,
    url,
    body,
    headers,
    signal,
    timeoutMs,
    serializer,
    onRequest,
    contextHeaderText,
  } = options;
  const controller =
    timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const signalLink = linkAbortSignals([signal, controller?.signal]);
  try {
    if (controller) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }
    const reqHeaders = {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    } as Record<string, string>;
    if (contextHeaderText) {
      reqHeaders[RUNNER_ASYNC_CONTEXT_HEADER] = contextHeaderText;
    }
    if (onRequest) await onRequest({ url, headers: reqHeaders });
    const res = await fetchFn(url, {
      method: "POST",
      headers: reqHeaders,
      body: serializer.stringify(body),
      signal: signalLink.signal,
      // Security: prevent automatic redirects from forwarding auth headers.
      redirect: "error",
    });

    const text = await res.text();
    const status =
      typeof (res as { status?: unknown }).status === "number"
        ? (res as { status: number }).status
        : 200;
    const statusText =
      typeof (res as { statusText?: unknown }).statusText === "string"
        ? (res as { statusText: string }).statusText
        : "";
    const ok =
      typeof (res as { ok?: unknown }).ok === "boolean"
        ? (res as { ok: boolean }).ok
        : status >= 200 && status < 300;
    const contentType =
      typeof (res as { headers?: { get?: (name: string) => string | null } })
        .headers?.get === "function"
        ? ((
            res as { headers: { get: (name: string) => string | null } }
          ).headers.get("content-type") ?? undefined)
        : undefined;

    if (!text) {
      if (!ok) {
        throw new RemoteLaneTransportError(
          "HTTP_ERROR",
          statusText
            ? `Remote lane HTTP ${status} ${statusText}`
            : `Remote lane HTTP ${status}`,
          { statusCode: status, statusText, contentType },
          { httpCode: status },
        );
      }
      // The endpoint returned an empty 2xx body — no payload to parse.
      // Callers that expect void/undefined return are safe; typed return T requires the cast.
      return undefined as T;
    }

    try {
      const json = serializer.parse<T>(text);
      return json;
    } catch (error) {
      if (!ok) {
        throw new RemoteLaneTransportError(
          "HTTP_ERROR",
          statusText
            ? `Remote lane HTTP ${status} ${statusText}`
            : `Remote lane HTTP ${status}`,
          {
            statusCode: status,
            statusText,
            contentType,
            bodyPreview: text.slice(0, 512),
          },
          { httpCode: status },
        );
      }
      throw error;
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    signalLink.cleanup();
  }
}

/**
 * This functions communicates with the exposure server over HTTP.
 * It uses the remote-lanes HTTP policy strategy.
 *
 * @param cfg
 * @returns
 */
export function createExposureFetch(
  cfg: ExposureFetchConfig,
): ExposureFetchClient {
  const baseUrl = cfg?.baseUrl?.replace(/\/$/, "");
  if (!baseUrl) {
    httpBaseUrlRequiredError.throw({ clientFactory: "createExposureFetch" });
  }

  const headerName = (cfg?.auth?.header ?? "x-runner-token").toLowerCase();
  const buildHeaders = () => {
    const headers: Record<string, string> = {};
    if (cfg?.auth?.token) headers[headerName] = cfg.auth.token;
    return headers;
  };

  const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (typeof fetchImpl !== "function") {
    httpFetchUnavailableError.throw({ clientFactory: "createExposureFetch" });
  }

  const buildContextHeader = () => {
    if (!cfg.contexts || cfg.contexts.length === 0) return undefined;
    const map: Record<string, string> = {};
    for (const asyncContext of cfg.contexts) {
      try {
        const value = asyncContext.use();
        map[asyncContext.id] = asyncContext.serialize(value);
      } catch {
        // context absent; ignore
      }
    }
    const keys = Object.keys(map);
    if (keys.length === 0) return undefined;
    return cfg.serializer.stringify(map);
  };

  return {
    async task<I, O>(
      id: string,
      input?: I,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<O> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { input },
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        return assertOkEnvelope<O>(r, {
          fallbackMessage: "Remote lane task error",
        });
      } catch (e) {
        // Optionally rethrow typed errors if registry present
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async event<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<void> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { payload },
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        assertOkEnvelope<void>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (e) {
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async eventWithResult<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<P> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<P> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { payload, returnPayload: true },
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      if (r && typeof r === "object" && r.ok && !("result" in r)) {
        throw new RemoteLaneTransportError(
          "INVALID_RESPONSE",
          "Remote lane event returnPayload requested but server did not include result. Upgrade the exposure server.",
        );
      }
      try {
        return assertOkEnvelope<P>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (e) {
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
  } satisfies ExposureFetchClient;
}
