import { defineResource } from "./define";
import type { TunnelRunner } from "./globals/resources/tunnel/types";
import { globalResources } from "./globals/globalResources";
import type { Logger } from "./models/Logger";

export interface ExposureFetchAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface ExposureFetchConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: ExposureFetchAuthConfig;
  timeoutMs?: number; // optional request timeout
  fetchImpl?: typeof fetch; // custom fetch (optional)
}

export interface ExposureFetchClient {
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
}

async function postJson<T = any>(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs?: number,
): Promise<T> {
  const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  let timeout: any;
  try {
    if (controller) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...headers,
      },
      body: JSON.stringify(body ?? {}),
      signal: controller?.signal,
    });

    const text = await res.text();
    const json = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return json;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createExposureFetch(cfg: ExposureFetchConfig): ExposureFetchClient {
  const baseUrl = (cfg?.baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("createExposureFetch requires baseUrl");

  const headerName = (cfg?.auth?.header ?? "x-runner-token").toLowerCase();
  const buildHeaders = () => {
    const headers: Record<string, string> = {};
    if (cfg?.auth?.token) headers[headerName] = cfg.auth.token;
    return headers;
  };

  const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available; provide fetchImpl in config");
  }

  return {
    async task<I, O>(id: string, input?: I): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;
      const r: any = await postJson(fetchImpl, url, { input }, buildHeaders(), cfg?.timeoutMs);
      if (!r?.ok) {
        const msg = r?.error?.message ?? "Tunnel task error";
        throw new Error(String(msg));
      }
      return r.result as O;
    },
    async event<P>(id: string, payload?: P): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: any = await postJson(fetchImpl, url, { payload }, buildHeaders(), cfg?.timeoutMs);
      if (!r?.ok) {
        const msg = r?.error?.message ?? "Tunnel event error";
        throw new Error(String(msg));
      }
    },
  } satisfies ExposureFetchClient;
}

// Universal fetch-based tunnel runner resource
export const httpFetchTunnel = defineResource<
  ExposureFetchConfig,
  Promise<TunnelRunner>,
  { logger: typeof globalResources.logger }
>({
  id: "platform.universal.resources.httpFetchTunnel",
  meta: {
    title: "HTTP Fetch Tunnel",
    description:
      "Client-side tunnel runner using fetch() to call a remote nodeExposure over HTTP JSON (POST-only).",
  },
  dependencies: { logger: globalResources.logger },
  async init(cfg, { logger }) {
    const client = createExposureFetch(cfg);
    return {
      run: async (t, input) => {
        try {
          return await client.task(t.id, input);
        } catch (e: any) {
          try {
            (logger as Logger).error("tunnel.task.error", { id: t.id, message: e?.message || String(e) });
          } catch (_) {}
          throw e instanceof Error ? e : new Error(String(e));
        }
      },
      emit: async (emission) => {
        try {
          await client.event(emission.id, emission.data as unknown);
        } catch (e: any) {
          try {
            (logger as Logger).error("tunnel.event.error", { id: emission.id, message: e?.message || String(e) });
          } catch (_) {}
          throw e instanceof Error ? e : new Error(String(e));
        }
      },
    } satisfies TunnelRunner;
  },
});

