import {
  assertOkEnvelope,
  ProtocolEnvelope,
} from "./globals/resources/tunnel/protocol";
import { Serializer } from "./globals/resources/tunnel/serializer";
import { normalizeError as _normalizeError } from "./globals/resources/tunnel/error-utils";
import type {
  ExposureFetchAuthConfig,
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

async function postSerialized<T = any>(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs?: number,
  serializer?: Serializer,
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>,
  contextHeaderText?: string,
): Promise<T> {
  const controller =
    timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  let timeout: any;
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
      body: (serializer as Serializer).stringify(body),
      signal: controller?.signal,
    });

    const text = await res.text();
    const json = text
      ? (serializer as Serializer).parse<T>(text)
      : (undefined as unknown as T);
    return json;
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
  const baseUrl = (cfg?.baseUrl).replace(/\/$/, "");
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
        map[ctx.id] = ctx.serialize(v as any);
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
      const r: ProtocolEnvelope<O> = await postSerialized(
        fetchImpl,
        url,
        { input },
        buildHeaders(),
        cfg?.timeoutMs,
        cfg.serializer,
        cfg?.onRequest,
        buildContextHeader(),
      );
      try {
        return assertOkEnvelope<O>(r, { fallbackMessage: "Tunnel task error" });
      } catch (e) {
        // Optionally rethrow typed errors if registry present
        const te = e as any;
        if (te && cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<void> = await postSerialized(
        fetchImpl,
        url,
        { payload },
        buildHeaders(),
        cfg?.timeoutMs,
        cfg.serializer,
        cfg?.onRequest,
        buildContextHeader(),
      );
      try {
        assertOkEnvelope<void>(r, { fallbackMessage: "Tunnel event error" });
      } catch (e) {
        const te = e as any;
        if (te && cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
  } satisfies ExposureFetchClient;
}
