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
 * Computes the delay before an RPC-lane retry.
 *
 * @param attempt Zero-based retry index (0 for the first retry delay).
 * @param error The failure that triggered the retry.
 * @returns Delay in milliseconds. Non-positive values skip the wait.
 */
export type RpcLaneRetryDelayStrategy = (
  attempt: number,
  error: unknown,
) => number;

/**
 * Transport-level retry policy for one RPC-lane binding.
 *
 * Retries apply to lane-routed calls in `network` mode only. They cover
 * failures without a definitive server answer (connection failures, timeouts,
 * overload statuses). Failures where the server executed and answered — typed
 * domain errors, most 4xx/5xx statuses — are never retried by default; use
 * task middleware (`retry`, `circuitBreaker`, `fallback`) for those.
 */
export interface RpcLaneRetryPolicy {
  /**
   * Total attempts per call, including the first attempt.
   * Defaults to 3. Use 1 to disable retries for this binding.
   */
  maxAttempts?: number;
  /**
   * Delay between attempts: a fixed millisecond count or a strategy.
   * Defaults to exponential backoff with jitter starting at 100ms.
   */
  delayMs?: number | RpcLaneRetryDelayStrategy;
  /**
   * Decides whether a failure is worth another attempt.
   * Defaults to retrying only transport failures without a server answer.
   */
  retryIf?: (error: unknown) => boolean;
}

/**
 * RPC-lane retry policy with defaults applied.
 */
export interface ResolvedRpcLaneRetryPolicy {
  /** Total attempts per call, including the initial attempt. */
  maxAttempts: number;
  /** Fixed delay or strategy evaluated before each retry. */
  delayMs: number | RpcLaneRetryDelayStrategy;
  /** Classifies failures that can consume another attempt. */
  retryIf: (error: unknown) => boolean;
}

/**
 * One RPC-lane binding inside a topology declaration.
 */
export interface IRpcLaneTopologyBinding {
  lane: IRpcLaneDefinition;
  communicator: RpcLaneCommunicatorResource;
  allowAsyncContext?: boolean;
  auth?: RemoteLaneBindingAuth;
  /**
   * Transport-level retry policy for calls routed through this binding.
   * Omit for the default policy (3 attempts, backoff, transport failures only).
   */
  retry?: RpcLaneRetryPolicy;
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
