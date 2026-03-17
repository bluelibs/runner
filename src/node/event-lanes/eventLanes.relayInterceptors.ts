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

function extractRelayLaneId(
  sourceId: string,
  relaySourcePrefix: string,
): string | undefined {
  const relayPayload = sourceId.slice(relaySourcePrefix.length);
  const profileSeparatorIndex = relayPayload.indexOf(":");
  if (
    profileSeparatorIndex < 0 ||
    profileSeparatorIndex === relayPayload.length - 1
  ) {
    return undefined;
  }

  const laneAndSuffix = relayPayload.slice(profileSeparatorIndex + 1);
  const optionalSuffixIndex = laneAndSuffix.indexOf(":");
  return optionalSuffixIndex < 0
    ? laneAndSuffix
    : laneAndSuffix.slice(0, optionalSuffixIndex);
}

export function registerEventLaneRelayInterceptors(options: {
  dependencies: RelayInterceptorDeps;
  context: Pick<
    EventLanesResourceContext,
    "relaySourcePrefix" | "hookAllowlistByLaneId"
  >;
}): void {
  const { dependencies, context } = options;

  dependencies.eventManager.intercept(async (next, emission) => {
    if (isRelayEmission(emission, context.relaySourcePrefix)) {
      attachCurrentEventLaneAsyncContexts(emission);
    }

    await next(emission);
  });

  dependencies.eventManager.interceptHook(async (next, hook, emission) => {
    if (isRelayEmission(emission, context.relaySourcePrefix)) {
      const relayLaneId = extractRelayLaneId(
        emission.source.id,
        context.relaySourcePrefix,
      );

      if (relayLaneId === undefined && context.hookAllowlistByLaneId.size > 0) {
        return;
      }

      const hookAllowlist =
        relayLaneId === undefined
          ? undefined
          : context.hookAllowlistByLaneId.get(relayLaneId);

      if (hookAllowlist && !hookAllowlist.has(hook.id)) {
        return;
      }
    }

    return withEventLaneEmissionAsyncContexts({
      emission,
      store: dependencies.store,
      serializer: dependencies.serializer,
      fn: async () => await next(hook, emission),
    });
  });
}
