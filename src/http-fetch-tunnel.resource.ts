import {
  assertOkEnvelope,
  ProtocolEnvelope,
  TunnelError,
} from "./globals/resources/tunnel/protocol";
import type { SerializerLike } from "./serializer";
import type {
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./globals/resources/tunnel/types";
export { normalizeError } from "./globals/resources/tunnel/error-utils";
export type {
  ExposureFetchAuthConfig,
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./globals/resources/tunnel/types";

// normalizeError is re-exported from error-utils for public API

async function postSerialized<T = any>(options: {
  fetch: typeof fetch;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  timeoutMs?: number;
  serializer: SerializerLike;
  onRequest?: (ctx: {
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
    timeoutMs,
    serializer,
    onRequest,
    contextHeaderText,
  } = options;
  const controller =
    timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (controller) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }
    const reqHeaders = {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    } as Record<string, string>;
    if (contextHeaderText) reqHeaders["x-runner-context"] = contextHeaderText;
    if (onRequest) await onRequest({ url, headers: reqHeaders });
    const res = await fetchFn(url, {
      method: "POST",
      headers: reqHeaders,
      body: serializer.stringify(body),
      signal: controller?.signal,
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
        throw new TunnelError(
          "HTTP_ERROR",
          statusText
            ? `Tunnel HTTP ${status} ${statusText}`
            : `Tunnel HTTP ${status}`,
          { statusCode: status, statusText, contentType },
          { httpCode: status },
        );
      }
      return undefined as unknown as T;
    }

    try {
      const json = serializer.parse<T>(text);
      return json;
    } catch (error) {
      if (!ok) {
        throw new TunnelError(
          "HTTP_ERROR",
          statusText
            ? `Tunnel HTTP ${status} ${statusText}`
            : `Tunnel HTTP ${status}`,
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
  }
}

/**
 * This functions communicates with the exposure server over HTTP.
 * It uses the @readmes/TUNNEL_HTTP_POLICY.md strategy.
 *
 * @param cfg
 * @returns
 */
export function createExposureFetch(
  cfg: ExposureFetchConfig,
): ExposureFetchClient {
  const baseUrl = cfg?.baseUrl?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("createExposureFetch requires baseUrl");

  const headerName = (cfg?.auth?.header ?? "x-runner-token").toLowerCase();
  const buildHeaders = () => {
    const headers: Record<string, string> = {};
    if (cfg?.auth?.token) headers[headerName] = cfg.auth.token;
    return headers;
  };

  const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "global fetch is not available; provide fetchImpl in config",
    );
  }

  const buildContextHeader = () => {
    if (!cfg.contexts || cfg.contexts.length === 0) return undefined;
    const map: Record<string, string> = {};
    for (const ctx of cfg.contexts) {
      try {
        const v = ctx.use();
        map[ctx.id] = ctx.serialize(v);
      } catch {
        // context absent; ignore
      }
    }
    const keys = Object.keys(map);
    if (keys.length === 0) return undefined;
    return cfg.serializer.stringify(map);
  };

  return {
    async task<I, O>(id: string, input?: I): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<O> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { input },
        headers: buildHeaders(),
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        return assertOkEnvelope<O>(r, { fallbackMessage: "Tunnel task error" });
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
    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<void> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { payload },
        headers: buildHeaders(),
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        assertOkEnvelope<void>(r, { fallbackMessage: "Tunnel event error" });
      } catch (e) {
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async eventWithResult<P>(id: string, payload?: P): Promise<P> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<P> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { payload, returnPayload: true },
        headers: buildHeaders(),
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      if (r && typeof r === "object" && r.ok && !("result" in r)) {
        throw new TunnelError(
          "INVALID_RESPONSE",
          "Tunnel event returnPayload requested but server did not include result. Upgrade the exposure server.",
        );
      }
      try {
        return assertOkEnvelope<P>(r, {
          fallbackMessage: "Tunnel event error",
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
