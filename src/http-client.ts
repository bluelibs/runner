import type { Serializer } from "./globals/resources/tunnel/serializer";
import type { ProtocolEnvelope } from "./globals/resources/tunnel/protocol";
import { assertOkEnvelope } from "./globals/resources/tunnel/protocol";
import { createExposureFetch } from "./http-fetch-tunnel.resource";
import { buildUniversalManifest } from "./tunnels/buildUniversalManifest";
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
  serializer: Serializer;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<any>>;
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

export function createHttpClient(cfg: HttpClientConfig): HttpClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) throw new Error("createHttpClient requires baseUrl");

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
    if (cfg.contexts && cfg.contexts.length > 0) {
      const map: Record<string, string> = {};
      for (const ctx of cfg.contexts) {
        try {
          const v = ctx.use();
          map[ctx.id] = ctx.serialize(v as any);
        } catch {}
      }
      if (Object.keys(map).length > 0) {
        headers["x-runner-context"] = cfg.serializer.stringify(map);
      }
    }
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
      if (input && typeof (input as any).pipe === "function") {
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
          const te = e as any;
          if (te && cfg.errorRegistry && te.id && te.data) {
            const helper = cfg.errorRegistry.get(String(te.id));
            if (helper) helper.throw(te.data);
          }
          throw e;
        }
      }

      // If Node files were detected, instruct user to use Node clients
      if (manifest.nodeFiles.length > 0) {
        throw new Error(
          "createHttpClient (universal) detected Node file input. Use @bluelibs/runner/node createHttpSmartClient or createHttpMixedClient for Node streaming/multipart.",
        );
      }

      // JSON/EJSON fallback
      try {
        return await fetchClient.task<I, O>(id, input as I);
      } catch (e) {
        const te = e as any;
        if (te && cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },

    async event<P>(id: string, payload?: P): Promise<void> {
      try {
        return await fetchClient.event<P>(id, payload);
      } catch (e) {
        const te = e as any;
        if (te && cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
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
        const te = e as any;
        if (te && cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
  };
}
