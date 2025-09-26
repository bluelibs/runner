import type { Readable } from "stream";
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
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
  ): Promise<O | Readable | ReadableStream<Uint8Array>>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
}

function toHeaders(auth?: HttpClientAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token)
    headers[(auth.header ?? "x-runner-token").toLowerCase()] = auth.token;
  return headers;
}

function isNodeReadable(value: unknown): value is Readable {
  return !!value && typeof (value as any).pipe === "function";
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
    async task<I, O>(
      id: string,
      input?: I,
    ): Promise<O | Readable | ReadableStream<Uint8Array>> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // Node Duplex path (request body is a Node Readable)
      if (isNodeReadable(input)) {
        // Delegate duplex path to Node Smart client (Node-only)
        const { createHttpSmartClient } = await import(
          "./node/http-smart-client.model"
        );
        return await createHttpSmartClient({
          baseUrl,
          auth: cfg.auth,
          timeoutMs: cfg.timeoutMs,
          serializer: cfg.serializer,
          onRequest: cfg.onRequest,
          contexts: cfg.contexts,
        }).task(id, input as any);
      }

      // Multipart path: gather both Node and Web files
      const manifest = buildUniversalManifest(input);
      if (manifest.nodeFiles.length > 0 || manifest.webFiles.length > 0) {
        const manifestText = cfg.serializer.stringify({
          input: manifest.input,
        });
        if (manifest.webFiles.length > 0 && manifest.nodeFiles.length === 0) {
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
        // Node multipart path (can handle both nodeFiles and webFiles by converting blobs to buffers)
        const { createHttpSmartClient } = await import(
          "./node/http-smart-client.model"
        );
        // Convert any web blobs into buffers (reads entirely in memory)
        if (manifest.webFiles.length > 0) {
          for (const wf of manifest.webFiles) {
            const arrayBuf = await (wf.blob as any).arrayBuffer();
            manifest.nodeFiles.push({
              id: wf.id,
              meta: wf.meta,
              source: { type: "buffer", buffer: Buffer.from(arrayBuf) },
            });
          }
          manifest.webFiles = [] as any;
        }
        const client = createHttpSmartClient({
          baseUrl,
          auth: cfg.auth,
          timeoutMs: cfg.timeoutMs,
          serializer: cfg.serializer,
          onRequest: cfg.onRequest,
          contexts: cfg.contexts,
        });
        // Use the underlying smart client multipart path by passing the original input structure
        try {
          return await client.task(id, manifest.input as any);
        } catch (e) {
          const te = e as any;
          if (te && cfg.errorRegistry && te.id && te.data) {
            const helper = cfg.errorRegistry.get(String(te.id));
            if (helper) helper.throw(te.data);
          }
          throw e;
        }
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
  };
}

export type { Readable };
