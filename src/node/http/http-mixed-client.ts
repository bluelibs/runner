import type { Readable } from "stream";
import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import type { SerializerLike } from "../../serializer";
import { createHttpSmartClient } from "./http-smart-client.model";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";

export interface MixedHttpClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface MixedHttpClientConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: MixedHttpClientAuthConfig;
  timeoutMs?: number;
  // Only used by the JSON path
  fetchImpl?: typeof fetch;
  /**
   * Forces the Smart client path even for plain JSON inputs.
   *
   * Use this when a task may return a stream even when its input is not a stream
   * and does not include Node File sentinels (ex: download endpoints).
   *
   * - `true`: always use Smart for tasks
   * - predicate: use Smart for selected task ids/inputs
   */
  forceSmart?:
    | boolean
    | ((ctx: { id: string; input: unknown }) => boolean | Promise<boolean>);
  serializer: SerializerLike;
  // Propagated to both JSON and Smart client paths
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

export interface MixedHttpClient {
  // If input is a Readable or contains Node/Web File sentinels, the return
  // can be a stream. Otherwise, it's JSON. In Node, the stream will be a Node Readable.
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
  ): Promise<O | Readable | ReadableStream<Uint8Array>>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
  eventWithResult?<P = unknown>(id: string, payload?: P): Promise<P>;
}

function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as { pipe?: unknown }).pipe === "function";
}

function hasNodeFile(value: unknown): boolean {
  const isNodeFileSentinel = (
    v: unknown,
  ): v is {
    $runnerFile: "File";
    id: string;
    _node?: { stream?: unknown; buffer?: unknown };
  } => {
    if (!v || typeof v !== "object") return false;
    const rec = v as Record<string, unknown>;
    if (rec.$runnerFile !== "File") return false;
    if (typeof rec.id !== "string") return false;
    const node = rec._node;
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    return Boolean(n.stream || n.buffer);
  };

  const visit = (v: unknown): boolean => {
    if (isNodeFileSentinel(v)) return true;
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(visit);
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (visit((v as Record<string, unknown>)[k])) return true;
    }
    return false;
  };
  return visit(value);
}

async function shouldForceSmart(
  cfg: MixedHttpClientConfig,
  id: string,
  input: unknown,
): Promise<boolean> {
  if (!cfg.forceSmart) return false;
  if (cfg.forceSmart === true) return true;
  return await cfg.forceSmart({ id, input });
}

/**
 * Unified Node client that mixes JSON fetch for standard calls and
 * Smart client for streaming/multipart. Keeps transport details out of app code.
 */
export function createHttpMixedClient(
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
    contexts: cfg.contexts,
    errorRegistry: cfg.errorRegistry,
  });
  const smartClient = createHttpSmartClient({
    baseUrl,
    auth: cfg.auth,
    timeoutMs: cfg.timeoutMs,
    serializer: cfg.serializer,
    onRequest: cfg.onRequest,
    contexts: cfg.contexts,
    errorRegistry: cfg.errorRegistry,
  });

  return {
    async task<I, O>(
      id: string,
      input?: I,
    ): Promise<O | Readable | ReadableStream<Uint8Array>> {
      // Prefer Smart path only when needed (streams or Node file sentinels)
      if (
        isReadable(input) ||
        hasNodeFile(input) ||
        (await shouldForceSmart(cfg, id, input))
      ) {
        return await smartClient.task<I, O>(id, input as I);
      }
      // Otherwise, lean JSON path
      return await fetchClient.task<I, O>(id, input as I);
    },
    async event<P>(id: string, payload?: P): Promise<void> {
      // Events are always plain JSON
      return await fetchClient.event<P>(id, payload);
    },
    async eventWithResult<P>(id: string, payload?: P): Promise<P> {
      if (!fetchClient.eventWithResult) {
        throw new Error(
          "createHttpMixedClient: eventWithResult not available on underlying tunnel client.",
        );
      }
      return await fetchClient.eventWithResult<P>(id, payload);
    },
  };
}

export type { Readable };
