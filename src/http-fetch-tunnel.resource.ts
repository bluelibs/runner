import { defineResource } from "./define";
import type { TunnelRunner } from "./globals/resources/tunnel/types";
import { globalResources } from "./globals/globalResources";
import type { Logger } from "./models/Logger";
import {
  assertOkEnvelope,
  ProtocolEnvelope,
  toTunnelError,
} from "./globals/resources/tunnel/protocol";
import {
  getDefaultSerializer,
  Serializer,
} from "./globals/resources/tunnel/serializer";
import { normalizeError as _normalizeError } from "./globals/resources/tunnel/error-utils";
export { normalizeError } from "./globals/resources/tunnel/error-utils";

export interface ExposureFetchAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface ExposureFetchConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: ExposureFetchAuthConfig;
  timeoutMs?: number; // optional request timeout
  fetchImpl?: typeof fetch; // custom fetch (optional)
  serializer?: Serializer; // optional serializer (defaults to JSON)
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

export interface ExposureFetchClient {
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
}

// normalizeError is re-exported from error-utils for public API

async function postJson<T = any>(
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
    if (onRequest) await onRequest({ url, headers: reqHeaders });
    const res = await fetchFn(url, {
      method: "POST",
      headers: reqHeaders,
      body: (serializer ?? getDefaultSerializer()).stringify(body),
      signal: controller?.signal,
    });

    const text = await res.text();
    const json = text
      ? (serializer ?? getDefaultSerializer()).parse<T>(text)
      : (undefined as unknown as T);
    return json;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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

  return {
    async task<I, O>(id: string, input?: I): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<O> = await postJson(
        fetchImpl,
        url,
        { input },
        buildHeaders(),
        cfg?.timeoutMs,
        cfg?.serializer,
        cfg?.onRequest,
      );
      return assertOkEnvelope<O>(r, { fallbackMessage: "Tunnel task error" });
    },
    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<void> = await postJson(
        fetchImpl,
        url,
        { payload },
        buildHeaders(),
        cfg?.timeoutMs,
        cfg?.serializer,
        cfg?.onRequest,
      );
      assertOkEnvelope<void>(r, { fallbackMessage: "Tunnel event error" });
    },
  } satisfies ExposureFetchClient;
}
