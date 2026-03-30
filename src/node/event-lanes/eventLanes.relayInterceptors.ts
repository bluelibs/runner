import type { EventManager } from "../../models/EventManager";
import type { Store } from "../../models/store/Store";
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

const LOCAL_SIMULATED_RELAY_SUFFIX = ":local-simulated";

function extractRelayLaneId(
  sourceId: string,
  relaySourcePrefix: string,
  profile: string,
  consumedLaneIds: ReadonlySet<string>,
): string | undefined {
  const relayPayload = sourceId.slice(relaySourcePrefix.length);
  const profilePrefix = `${profile}:`;
  if (!relayPayload.startsWith(profilePrefix)) {
    return undefined;
  }

  const lanePayload = relayPayload.slice(profilePrefix.length);
  if (!lanePayload) {
    return undefined;
  }

  if (consumedLaneIds.has(lanePayload)) {
    return lanePayload;
  }

  if (!lanePayload.endsWith(LOCAL_SIMULATED_RELAY_SUFFIX)) {
    return undefined;
  }

  const laneId = lanePayload.slice(0, -LOCAL_SIMULATED_RELAY_SUFFIX.length);
  return laneId && consumedLaneIds.has(laneId) ? laneId : undefined;
}

export function registerEventLaneRelayInterceptors(options: {
  dependencies: RelayInterceptorDeps;
  context: Pick<
    EventLanesResourceContext,
    | "relaySourcePrefix"
    | "profile"
    | "consumedLaneIds"
    | "hookAllowlistByLaneId"
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
        context.profile,
        context.consumedLaneIds,
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
