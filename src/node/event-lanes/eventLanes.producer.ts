import { issueRemoteLaneToken } from "../remote-lanes/laneAuth";
import { buildSerializedEventLaneAsyncContexts } from "./eventLanes.asyncContext";
import { getLaneBindingOrThrow, isRelayEmission } from "./EventLanesInternals";
import { resolveEventLaneBindingAuth } from "./eventLanes.auth";
import type { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import type { EventLanesResourceConfig } from "./types";
import type { EventLanesResourceContext } from "./EventLanesInternals";
import type { EventManager } from "../../models/EventManager";
import type { Store } from "../../models/Store";
import type { SerializerLike } from "../../serializer";
import { resolveRemoteLanesMode } from "../remote-lanes/mode";

type ProducerDeps = {
  eventManager: EventManager;
  store: Store;
  serializer: SerializerLike;
};

export function registerEventLaneProducerInterceptor(options: {
  config: EventLanesResourceConfig;
  dependencies: ProducerDeps;
  context: EventLanesResourceContext;
  diagnostics: EventLanesDiagnostics;
}): void {
  const { config, dependencies, context, diagnostics } = options;

  dependencies.eventManager.intercept(async (next, emission) => {
    if (context.disposed || context.coolingDown) {
      return next(emission);
    }

    if (isRelayEmission(emission, context.relaySourcePrefix)) {
      return next(emission);
    }

    const resolvedEmissionId = emission.id;
    const eventRoute = context.eventRouteByEventId.get(resolvedEmissionId);
    if (!eventRoute) {
      return next(emission);
    }

    const binding = getLaneBindingOrThrow(
      eventRoute.lane.id,
      context.bindingsByLaneId,
    );
    const bindingAuth = resolveEventLaneBindingAuth({
      laneId: eventRoute.lane.id,
      context,
      config,
    });
    const authToken = issueRemoteLaneToken({
      laneId: eventRoute.lane.id,
      bindingAuth,
      capability: "produce",
    });

    await binding.queue.enqueue({
      laneId: eventRoute.lane.id,
      eventId: resolvedEmissionId,
      payload: dependencies.serializer.stringify(emission.data),
      serializedAsyncContexts: buildSerializedEventLaneAsyncContexts({
        lane: eventRoute.lane,
        store: dependencies.store,
        serializer: dependencies.serializer,
      }),
      source: emission.source,
      authToken,
      maxAttempts: binding.maxAttempts ?? 1,
    });
    emission.stopPropagation();
    await diagnostics.logEnqueue({
      eventId: resolvedEmissionId,
      laneId: eventRoute.lane.id,
      profile: context.profile,
      mode: resolveRemoteLanesMode(config.mode),
      sourceKind: emission.source.kind,
      sourceId: emission.source.id,
    });
  });
}
