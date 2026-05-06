import { AsyncLocalStorage } from "node:async_hooks";
import type { IEventLaneDefinition } from "../../defs";
import type { IEventEmission } from "../../types/event";
import type { Store } from "../../models/store/Store";
import type { SerializerLike } from "../../serializer";
import {
  buildAsyncContextHeader,
  resolveLaneAsyncContextAllowList,
  withSerializedAsyncContexts,
} from "../remote-lanes/asyncContextAllowlist";

const eventLaneRelayAsyncContextStorage =
  new AsyncLocalStorage<EventLaneRelayAsyncContextState>();
const eventLaneRelayAsyncContextByEmission = new WeakMap<
  IEventEmission<unknown>,
  EventLaneRelayAsyncContextState
>();

type EventLaneRelayAsyncContextState = {
  serializedAsyncContexts?: string;
  allowedAsyncContextIds?: readonly string[];
};

export function resolveEventLaneAllowedAsyncContextIds(
  lane: Pick<IEventLaneDefinition, "asyncContexts">,
): readonly string[] | undefined {
  return resolveLaneAsyncContextAllowList({
    laneAsyncContexts: lane.asyncContexts,
  });
}

export function buildSerializedEventLaneAsyncContexts(options: {
  lane: IEventLaneDefinition;
  store: Pick<Store, "asyncContexts">;
  serializer: SerializerLike;
}): string | undefined {
  const { lane, serializer, store } = options;
  return buildAsyncContextHeader({
    allowList: resolveEventLaneAllowedAsyncContextIds(lane),
    registry: store.asyncContexts,
    serializer,
  });
}

export async function withEventLaneAsyncContexts<T>(options: {
  lane?: IEventLaneDefinition;
  allowedAsyncContextIds?: readonly string[];
  serializedAsyncContexts?: string;
  store: Pick<Store, "asyncContexts">;
  serializer: SerializerLike;
  fn: () => Promise<T>;
}): Promise<T> {
  const { lane, serializedAsyncContexts, serializer, store, fn } = options;
  const resolvedAllowedAsyncContextIds =
    options.allowedAsyncContextIds ??
    (lane ? resolveEventLaneAllowedAsyncContextIds(lane) : undefined);

  return eventLaneRelayAsyncContextStorage.run(
    {
      serializedAsyncContexts,
      allowedAsyncContextIds: resolvedAllowedAsyncContextIds,
    },
    () =>
      withSerializedAsyncContexts({
        serializedContexts: serializedAsyncContexts,
        registry: store.asyncContexts,
        serializer,
        fn,
        allowedAsyncContextIds: resolvedAllowedAsyncContextIds,
      }),
  );
}

export function attachCurrentEventLaneAsyncContexts(
  emission: IEventEmission<unknown>,
): void {
  const relayState = eventLaneRelayAsyncContextStorage.getStore();
  if (
    !relayState ||
    (relayState.serializedAsyncContexts === undefined &&
      relayState.allowedAsyncContextIds === undefined)
  ) {
    return;
  }

  eventLaneRelayAsyncContextByEmission.set(emission, relayState);
}

export async function withEventLaneEmissionAsyncContexts<T>(options: {
  emission: IEventEmission<unknown>;
  store: Pick<Store, "asyncContexts">;
  serializer: SerializerLike;
  fn: () => Promise<T>;
}): Promise<T> {
  const relayState = eventLaneRelayAsyncContextByEmission.get(options.emission);
  if (!relayState) {
    return options.fn();
  }

  return withSerializedAsyncContexts({
    serializedContexts: relayState.serializedAsyncContexts,
    registry: options.store.asyncContexts,
    serializer: options.serializer,
    fn: options.fn,
    allowedAsyncContextIds: relayState.allowedAsyncContextIds,
  });
}
