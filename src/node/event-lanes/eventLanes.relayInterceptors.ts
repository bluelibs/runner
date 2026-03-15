import type { EventManager } from "../../models/EventManager";
import type { Store } from "../../models/Store";
import type { SerializerLike } from "../../serializer";
import type { EventLanesResourceContext } from "./EventLanesInternals";
import { isRelayEmission } from "./EventLanesInternals";
import {
  attachCurrentEventLaneAsyncContexts,
  withEventLaneEmissionAsyncContexts,
} from "./eventLanes.asyncContext";

type RelayInterceptorDeps = {
  eventManager: EventManager;
  store: Pick<Store, "asyncContexts">;
  serializer: SerializerLike;
};

export function registerEventLaneRelayInterceptors(options: {
  dependencies: RelayInterceptorDeps;
  context: Pick<EventLanesResourceContext, "relaySourcePrefix">;
}): void {
  const { dependencies, context } = options;

  dependencies.eventManager.intercept(async (next, emission) => {
    if (isRelayEmission(emission, context.relaySourcePrefix)) {
      attachCurrentEventLaneAsyncContexts(emission);
    }

    await next(emission);
  });

  dependencies.eventManager.interceptHook(async (next, hook, emission) => {
    return withEventLaneEmissionAsyncContexts({
      emission,
      store: dependencies.store,
      serializer: dependencies.serializer,
      fn: async () => await next(hook, emission),
    });
  });
}
