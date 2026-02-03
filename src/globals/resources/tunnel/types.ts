import type { ITask, IEvent, IEventEmission } from "../../../defs";
import type { IAsyncContext } from "../../../types/asyncContext";
import type { IErrorHelper } from "../../../types/error";
import type { SerializerLike } from "../../../serializer";

export type { SerializerLike as Serializer } from "../../../serializer";

export type TunnelMode = "client" | "server" | "both" | "none";

export type TunnelTaskSelector =
  | Array<string | ITask<any, any, any, any, any, any>>
  | ((task: ITask<any, any, any, any, any, any>) => boolean);

export type TunnelEventSelector =
  | Array<string | IEvent<any>>
  | ((event: IEvent<any>) => boolean);

export type EventDeliveryMode =
  | "mirror"
  | "remote-only"
  | "local-only"
  | "remote-first";

export interface TunnelTagConfig {}

export type TunnelTaskRunner = (
  task: ITask<any, any, any, any, any, any>,
  input?: any,
) => Promise<any>;

export interface TunnelRunner {
  transport?: "http" | string;
  mode?: TunnelMode;
  tasks?: TunnelTaskSelector;
  events?: TunnelEventSelector;
  eventDeliveryMode?: EventDeliveryMode;
  // Called when a tunneled task runs; receives the task definition
  run?: TunnelTaskRunner;
  // Called when a tunneled event is emitted; receives the event definition
  emit?: (event: IEventEmission<any>) => Promise<any>;
}

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
  task<I = unknown, O = unknown>(id: string, input?: I): Promise<O>;
  event<P = unknown>(id: string, payload?: P): Promise<void>;
  /**
   * Emits an event and returns the final payload as seen by the remote Runner.
   * Requires server support; older servers will respond with `{ ok: true }`
   * without `result`, in which case clients should throw.
   */
  eventWithResult?<P = unknown>(id: string, payload?: P): Promise<P>;
}
