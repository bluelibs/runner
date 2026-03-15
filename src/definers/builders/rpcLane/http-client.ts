import { createHttpClient } from "../../../http-client";
import type { Store } from "../../../models/Store";
import type { IRpcLaneCommunicator } from "../../../defs";
import {
  rpcLaneCommunicatorContractError,
  rpcLaneHttpClientPresetNotFoundError,
} from "../../../errors";
import {
  createErrorRegistry,
  createForwardingRpcLaneCommunicator,
  resolveSerializer,
} from "./http-client.utils";

export interface RpcLaneHttpClientConfig {
  client?: "fetch" | "mixed" | "smart" | (string & {});
  baseUrl: string;
  auth?: { header?: string; token: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  forceSmart?:
    | boolean
    | ((ctx: { id: string; input: unknown }) => boolean | Promise<boolean>);
}

export type RpcLaneHttpClientPresetHandler = (
  config: RpcLaneHttpClientConfig,
  dependencies: Record<string, unknown>,
) => Promise<IRpcLaneCommunicator> | IRpcLaneCommunicator;

const rpcLaneHttpClientPresets = new Map<
  string,
  RpcLaneHttpClientPresetHandler
>();

export function registerRpcLaneHttpClientPreset(
  id: string,
  handler: RpcLaneHttpClientPresetHandler,
) {
  rpcLaneHttpClientPresets.set(id, handler);
}

registerRpcLaneHttpClientPreset("fetch", (config, dependencies) => {
  const store = dependencies.store as Store | undefined;
  const serializer = resolveSerializer(dependencies);
  const client = createHttpClient({
    baseUrl: config.baseUrl,
    auth: config.auth,
    timeoutMs: config.timeoutMs,
    fetchImpl: config.fetchImpl,
    onRequest: config.onRequest,
    serializer,
    contexts: [],
    errorRegistry: createErrorRegistry(store),
  });

  return createForwardingRpcLaneCommunicator(client);
});

export function rpcLaneHttpClient(config: RpcLaneHttpClientConfig) {
  return async (
    _resourceConfig: unknown,
    dependencies: Record<string, unknown>,
  ) => {
    const presetId = config.client ?? "fetch";
    const preset = rpcLaneHttpClientPresets.get(presetId);
    if (!preset) {
      rpcLaneHttpClientPresetNotFoundError.throw({
        presetId,
        availablePresets: Array.from(rpcLaneHttpClientPresets.keys()),
      });
    }

    const communicator = await preset!(config, dependencies);
    if (
      !communicator ||
      typeof communicator !== "object" ||
      (typeof communicator.task !== "function" &&
        typeof communicator.event !== "function" &&
        typeof communicator.eventWithResult !== "function")
    ) {
      rpcLaneCommunicatorContractError.throw({
        message:
          "rpcLane communicator must expose at least one RPC method: task(id, input), event(id, payload), or eventWithResult(id, payload).",
      });
    }

    return communicator;
  };
}
