import type {
  IRpcLaneMeta,
  IRpcLanesTopology,
  IRpcLaneTopologyBinding,
  IRpcLaneTopologyProfile,
} from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeRpcLaneBuilder } from "./fluent-builder";
import type { RpcLaneFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import {
  registerRpcLaneHttpClientPreset,
  rpcLaneHttpClient,
} from "./http-client";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";
export * from "./http-client";

/**
 * Creates a fluent RPC-lane builder.
 */
export function rpcLaneBuilder(id: string): RpcLaneFluentBuilder {
  const filePath = getCallerFile();
  const initial: BuilderState<IRpcLaneMeta> = Object.freeze({
    id,
    filePath,
    meta: {} as IRpcLaneMeta,
    policy: undefined,
    applyTo: undefined,
    asyncContexts: undefined,
  });

  return makeRpcLaneBuilder(initial);
}

/**
 * Freezes an RPC-lane topology declaration so profile and binding references stay stable.
 */
export function rpcLanesTopologyBuilder<
  const TBindings extends readonly IRpcLaneTopologyBinding[],
  const TProfiles extends Record<
    string,
    IRpcLaneTopologyProfile<TBindings[number]["lane"]>
  >,
>(
  topology: IRpcLanesTopology<TBindings, TProfiles>,
): IRpcLanesTopology<TBindings, TProfiles> {
  return deepFreeze(topology);
}

export interface RpcLaneBuilderWithTopology {
  (id: string): RpcLaneFluentBuilder;
  topology: typeof rpcLanesTopologyBuilder;
  httpClient: typeof rpcLaneHttpClient;
}

/**
 * RPC-lane builder namespace with topology and HTTP-client helpers attached.
 */
export const rpcLane: RpcLaneBuilderWithTopology = Object.assign(
  rpcLaneBuilder,
  {
    topology: rpcLanesTopologyBuilder,
    httpClient: rpcLaneHttpClient,
  },
);

/**
 * Registers named RPC HTTP client presets for later lookup by topology profiles.
 */
export { registerRpcLaneHttpClientPreset };
