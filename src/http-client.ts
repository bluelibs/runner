import type { Readable } from "stream";
import type { Serializer } from "./globals/resources/tunnel/serializer";
import { getDefaultSerializer } from "./globals/resources/tunnel/serializer";
import type { ProtocolEnvelope } from "./globals/resources/tunnel/protocol";
import { assertOkEnvelope } from "./globals/resources/tunnel/protocol";
import { createExposureFetch } from "./http-fetch-tunnel.resource";
import { buildUniversalManifest } from "./tunnels/buildUniversalManifest";

export interface HttpClientAuth {
  header?: string;
  token: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  auth?: HttpClientAuth;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  serializer?: Serializer;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
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
    if (cfg.onRequest) await cfg.onRequest({ url, headers });
    const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
    const res = await fetchImpl(url, { method: "POST", body: fd, headers });
    const text = await res.text();
    const json = text
      ? (cfg.serializer ?? getDefaultSerializer()).parse(text)
      : undefined;
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
          "./node/http-smart-client.node.ts"
        );
        return await createHttpSmartClient({
          baseUrl,
          auth: cfg.auth,
          timeoutMs: cfg.timeoutMs,
          onRequest: cfg.onRequest,
        }).task(id, input as any);
      }

      // Multipart path: gather both Node and Web files
      const manifest = buildUniversalManifest(input);
      if (manifest.nodeFiles.length > 0 || manifest.webFiles.length > 0) {
        const manifestText = (
          cfg.serializer ?? getDefaultSerializer()
        ).stringify({ input: manifest.input });
        if (manifest.webFiles.length > 0 && manifest.nodeFiles.length === 0) {
          const r = await postMultipartBrowser(
            url,
            manifestText,
            manifest.webFiles,
          );
          return assertOkEnvelope<O>(r as ProtocolEnvelope<O>, {
            fallbackMessage: "Tunnel task error",
          });
        }
        // Node multipart path (can handle both nodeFiles and webFiles by converting blobs to buffers)
        const { createHttpSmartClient } = await import(
          "./node/http-smart-client.node.ts"
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
          onRequest: cfg.onRequest,
        });
        // Use the underlying smart client multipart path by passing the original input structure
        return await client.task(id, manifest.input as any);
      }

      // JSON/EJSON fallback
      return await fetchClient.task<I, O>(id, input as I);
    },

    async event<P>(id: string, payload?: P): Promise<void> {
      return await fetchClient.event<P>(id, payload);
    },
  };
}

export type { Readable };
