import { Serializer } from "../../../serializer";
import type { SerializerLike } from "../../../serializer";
import type { Store } from "../../../models/store/Store";
import type { IErrorHelper } from "../../../types/error";

type RpcLaneRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type RpcLaneCommunicatorLike = {
  task?: (
    id: string,
    input?: unknown,
    options?: RpcLaneRequestOptions,
  ) => Promise<unknown>;
  event?: (
    id: string,
    payload?: unknown,
    options?: RpcLaneRequestOptions,
  ) => Promise<void>;
  eventWithResult?: (
    id: string,
    payload?: unknown,
    options?: RpcLaneRequestOptions,
  ) => Promise<unknown>;
};

export function createErrorRegistry(
  store?: Store,
): Map<string, IErrorHelper<any>> {
  const map = new Map<string, IErrorHelper<any>>();
  if (!store) {
    return map;
  }

  for (const [id, helper] of store.errors) {
    map.set(id, helper);
  }

  return map;
}

export function resolveSerializer(
  dependencies: Record<string, unknown>,
): SerializerLike {
  const serializer = dependencies.serializer as SerializerLike | undefined;
  if (serializer) {
    return serializer;
  }

  return new Serializer();
}

export function createForwardingRpcLaneCommunicator<
  TClient extends RpcLaneCommunicatorLike,
>(client: TClient, options: { strictEventWithResult?: boolean } = {}) {
  const { strictEventWithResult = false } = options;

  return {
    task: async (
      id: string,
      input?: unknown,
      options?: RpcLaneRequestOptions,
    ) =>
      options ? client.task?.(id, input, options) : client.task?.(id, input),
    event: async (
      id: string,
      payload?: unknown,
      options?: RpcLaneRequestOptions,
    ) =>
      options
        ? client.event?.(id, payload, options)
        : client.event?.(id, payload),
    eventWithResult: async (
      id: string,
      payload?: unknown,
      options?: RpcLaneRequestOptions,
    ) =>
      strictEventWithResult
        ? options
          ? client.eventWithResult!(id, payload, options)
          : client.eventWithResult!(id, payload)
        : options
          ? client.eventWithResult?.(id, payload, options)
          : client.eventWithResult?.(id, payload),
  };
}
