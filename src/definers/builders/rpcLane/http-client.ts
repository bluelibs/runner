import { createHttpClient } from "../../../http-client";
import { Serializer } from "../../../serializer";
import type { IErrorHelper } from "../../../types/error";
import type { Store } from "../../../models/Store";
import type { IRpcLaneCommunicator } from "../../../defs";
import type { SerializerLike } from "../../../serializer";
import type {
  HttpClientFactory,
  HttpClientFactoryConfig,
} from "../../../globals/resources/httpClientFactory.resource";
import {
  rpcLaneCommunicatorContractError,
  rpcLaneHttpClientPresetNotFoundError,
} from "../../../errors";

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

function createErrorRegistry(store?: Store): Map<string, IErrorHelper<any>> {
  const map = new Map<string, IErrorHelper<any>>();
  if (!store) return map;

  for (const [id, helper] of store.errors) {
    map.set(id, helper);
  }

  return map;
}

function resolveSerializer(
  dependencies: Record<string, unknown>,
): SerializerLike {
  const serializer = dependencies.serializer as SerializerLike | undefined;
  if (serializer) return serializer;
  return new Serializer();
}

function toFactoryConfig(
  config: RpcLaneHttpClientConfig,
): HttpClientFactoryConfig {
  return {
    baseUrl: config.baseUrl,
    auth: config.auth,
    timeoutMs: config.timeoutMs,
    fetchImpl: config.fetchImpl,
    onRequest: config.onRequest,
  };
}

registerRpcLaneHttpClientPreset("fetch", (config, dependencies) => {
  const factory = dependencies.clientFactory as HttpClientFactory | undefined;

  if (factory) {
    const client = factory(toFactoryConfig(config));
    return {
      task: async (id, input, options) =>
        options ? client.task(id, input, options) : client.task(id, input),
      event: async (id, payload, options) =>
        options
          ? client.event(id, payload, options)
          : client.event(id, payload),
      eventWithResult: async (id, payload, options) =>
        options
          ? client.eventWithResult?.(id, payload, options)
          : client.eventWithResult?.(id, payload),
    };
  }

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

  return {
    task: async (id, input, options) =>
      options ? client.task(id, input, options) : client.task(id, input),
    event: async (id, payload, options) =>
      options ? client.event(id, payload, options) : client.event(id, payload),
    eventWithResult: async (id, payload, options) =>
      options
        ? client.eventWithResult?.(id, payload, options)
        : client.eventWithResult?.(id, payload),
  };
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
