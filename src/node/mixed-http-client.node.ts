import type { Readable } from "stream";
import { createExposureFetch } from "../http-fetch-tunnel.resource";
import type { Serializer } from "../globals/resources/tunnel/serializer";
import { createHttpClient } from "../http-client";

export interface MixedHttpClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface MixedHttpClientConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: MixedHttpClientAuthConfig;
  timeoutMs?: number;
  // Only used by the JSON/EJSON path
  fetchImpl?: typeof fetch;
  serializer?: Serializer;
  // Propagated to both JSON and Smart client paths
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

export interface MixedHttpClient {
  // If input is a Readable or contains Node/Web File sentinels, the return
  // can be a stream. Otherwise, it's JSON. In Node, the stream will be a Node Readable.
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
  ): Promise<O | Readable | ReadableStream<Uint8Array>>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
}

function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as any).pipe === "function";
}

function hasNodeFile(value: unknown): boolean {
  const visit = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if ((v as any).$ejson === "File" && typeof (v as any).id === "string") {
      const node = (v as any)._node;
      if (node && (node.stream || node.buffer)) return true;
    }
    if (Array.isArray(v)) return v.some(visit);
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (visit((v as Record<string, unknown>)[k])) return true;
    }
    return false;
  };
  return visit(value);
}

/**
 * Unified Node client that mixes JSON/EJSON fetch for standard calls and
 * Smart client for streaming/multipart. Keeps transport details out of app code.
 */
export function createMixedHttpClient(
  cfg: MixedHttpClientConfig,
): MixedHttpClient {
  const baseUrl = cfg.baseUrl?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("createMixedHttpClient requires baseUrl");

  // Lazy singletons for underlying clients
  const fetchClient = createExposureFetch({
    baseUrl,
    auth: cfg.auth,
    timeoutMs: cfg.timeoutMs,
    fetchImpl: cfg.fetchImpl,
    serializer: cfg.serializer,
    onRequest: cfg.onRequest,
  });
  const smartClient = createHttpClient({
    baseUrl,
    auth: cfg.auth,
    timeoutMs: cfg.timeoutMs,
    fetchImpl: cfg.fetchImpl,
    serializer: cfg.serializer,
    onRequest: cfg.onRequest,
  });

  return {
    async task<I, O>(
      id: string,
      input?: I,
    ): Promise<O | Readable | ReadableStream<Uint8Array>> {
      // Prefer Smart path only when needed (streams or Node file sentinels)
      if (isReadable(input) || hasNodeFile(input)) {
        return await smartClient.task<I, O>(id, input as I);
      }
      // Otherwise, lean JSON/EJSON path
      return await fetchClient.task<I, O>(id, input as I);
    },
    async event<P>(id: string, payload?: P): Promise<void> {
      // Events are always plain JSON/EJSON
      return await fetchClient.event<P>(id, payload);
    },
  };
}

export type { Readable };
