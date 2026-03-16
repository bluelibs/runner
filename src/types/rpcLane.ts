import type { IResource } from "./resource";
import type { IRpcLaneMeta } from "./meta";
import type { IEventDefinition } from "./event";
import type { ITaskDefinition } from "./task";
import type { IAsyncContext } from "./asyncContext";
import type { RemoteLaneBindingAuth } from "./remoteLaneAuth";
import { symbolFilePath, symbolRpcLane } from "./utilities";

/**
 * Identifier used when allow-listing middleware for RPC-lane execution.
 */
export type RpcLaneMiddlewareId = string | { id: string };

/**
 * Policy options applied when work is routed through an RPC lane.
 */
export interface IRpcLanePolicy {
  middlewareAllowList?: readonly RpcLaneMiddlewareId[];
}

/**
 * Definition contract for an RPC lane.
 */
export interface IRpcLaneDefinition {
  id: string;
  meta?: IRpcLaneMeta;
  policy?: IRpcLanePolicy;
  applyTo?:
    | readonly (ITaskDefinition<any> | IEventDefinition<any> | string)[]
    | ((target: ITaskDefinition<any> | IEventDefinition<any>) => boolean);
  asyncContexts?: readonly (IAsyncContext<unknown> | string)[];
  [symbolFilePath]?: string;
}

/**
 * Frozen RPC-lane definition returned by `defineRpcLane(...)`.
 */
export interface IRpcLane extends IRpcLaneDefinition {
  id: string;
  meta: IRpcLaneMeta;
  [symbolRpcLane]: true;
  [symbolFilePath]: string;
}

/**
 * Transport adapter used by an RPC lane to execute remote work.
 */
export interface IRpcLaneCommunicator {
  task?(
    id: string,
    input?: unknown,
    options?: RpcLaneRequestOptions,
  ): Promise<unknown>;
  event?(
    id: string,
    payload?: unknown,
    options?: RpcLaneRequestOptions,
  ): Promise<void>;
  eventWithResult?(
    id: string,
    payload?: unknown,
    options?: RpcLaneRequestOptions,
  ): Promise<unknown>;
}

/**
 * Per-request transport options forwarded to the communicator.
 */
export interface RpcLaneRequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Resource dependency shape expected by RPC-lane topology bindings.
 */
export type RpcLaneCommunicatorResource = IResource<
  any,
  Promise<any>,
  any,
  any,
  any,
  any,
  any
>;

/**
 * One RPC-lane binding inside a topology declaration.
 */
export interface IRpcLaneTopologyBinding {
  lane: IRpcLaneDefinition;
  communicator: RpcLaneCommunicatorResource;
  allowAsyncContext?: boolean;
  auth?: RemoteLaneBindingAuth;
}

/**
 * Named RPC-lane profile listing the lanes a server should expose.
 */
export interface IRpcLaneTopologyProfile<
  TLane extends IRpcLaneDefinition = IRpcLaneDefinition,
> {
  serve: readonly TLane[];
}

/**
 * RPC-lane topology declaration used to connect lanes, profiles, and communicators.
 */
export interface IRpcLanesTopology<
  TBindings extends readonly IRpcLaneTopologyBinding[] =
    readonly IRpcLaneTopologyBinding[],
  TProfiles extends Record<
    string,
    IRpcLaneTopologyProfile<TBindings[number]["lane"]>
  > = Record<string, IRpcLaneTopologyProfile<TBindings[number]["lane"]>>,
> {
  profiles: TProfiles;
  bindings: TBindings;
}
