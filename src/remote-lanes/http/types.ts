import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";
import type { SerializerLike } from "../../serializer";

export type { SerializerLike as Serializer } from "../../serializer";

export interface ExposureFetchAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface ExposureFetchConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: ExposureFetchAuthConfig;
  timeoutMs?: number; // optional request timeout
  fetchImpl?: typeof fetch; // custom fetch (optional)
  serializer: SerializerLike; // required serializer
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

export interface ExposureFetchClient {
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
    options?: { headers?: Record<string, string> },
  ): Promise<O>;
  event<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string> },
  ): Promise<void>;
  /**
   * Emits an event and returns the final payload as seen by the remote Runner.
   * Requires server support; older servers will respond with `{ ok: true }`
   * without `result`, in which case clients should throw.
   */
  eventWithResult?<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string> },
  ): Promise<P>;
}
