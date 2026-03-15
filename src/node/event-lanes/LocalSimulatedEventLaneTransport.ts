import { AsyncResource } from "node:async_hooks";
import { eventLaneEventNotRegisteredError } from "../../errors";
import { runtimeSource } from "../../types/runtimeSource";
import type { RemoteLaneBindingAuth } from "../../defs";
import type { EventManager } from "../../models/EventManager";
import type { Logger } from "../../models/Logger";
import type { Store } from "../../models/Store";
import type { Serializer } from "../../serializer";
import type { EventLaneMessage } from "./types";
import type { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import type { EventLanesResourceContext } from "./EventLanesInternals";
import { isRelayEmission } from "./EventLanesInternals";
import {
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../remote-lanes/laneAuth";
import {
  buildSerializedEventLaneAsyncContexts,
  withEventLaneAsyncContexts,
} from "./eventLanes.asyncContext";

type Dependencies = {
  eventManager: EventManager;
  serializer: Serializer;
  store: Store;
  logger: Logger;
};

export class LocalSimulatedEventLaneTransport {
  private sequence = 0;
  private readonly relayScope = new AsyncResource(
    "runner.eventLanes.localSimulated",
  );

  constructor(
    private readonly dependencies: Dependencies,
    private readonly context: EventLanesResourceContext,
    private readonly diagnostics: EventLanesDiagnostics,
    private readonly bindingAuthByLaneId: ReadonlyMap<
      string,
      RemoteLaneBindingAuth | undefined
    > = new Map(),
  ) {}

  public register() {
    this.dependencies.eventManager.intercept(async (next, emission) => {
      if (isRelayEmission(emission, this.context.relaySourcePrefix)) {
        return next(emission);
      }

      const eventId = emission.id;
      const eventRoute = this.context.eventRouteByEventId.get(eventId);
      if (!eventRoute) {
        return next(emission);
      }

      emission.stopPropagation();
      const bindingAuth = this.resolveBindingAuth(eventRoute.lane.id);
      const authToken = issueRemoteLaneToken({
        laneId: eventRoute.lane.id,
        bindingAuth,
        capability: "produce",
      });
      const message: EventLaneMessage = {
        id: `sim-${++this.sequence}`,
        laneId: eventRoute.lane.id,
        eventId,
        payload: this.dependencies.serializer.stringify(emission.data),
        serializedAsyncContexts: buildSerializedEventLaneAsyncContexts({
          lane: eventRoute.lane,
          store: this.dependencies.store,
          serializer: this.dependencies.serializer,
        }),
        source: emission.source,
        authToken,
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 1,
      };

      await this.diagnostics.logEnqueue({
        eventId,
        laneId: eventRoute.lane.id,
        profile: this.context.profile,
        mode: "local-simulated",
        sourceKind: emission.source.kind,
        sourceId: emission.source.id,
      });

      this.scheduleRelay(message);
    });
  }

  private scheduleRelay(message: EventLaneMessage): void {
    this.relayScope.runInAsyncScope(() => {
      setTimeout(() => {
        void this.relay(message);
      }, 0);
    });
  }

  private async relay(message: EventLaneMessage): Promise<void> {
    if (this.context.coolingDown || this.context.disposed) {
      return;
    }

    try {
      const eventRoute = this.context.eventRouteByEventId.get(message.eventId);
      const eventStoreEntry = this.dependencies.store.events.get(
        message.eventId,
      );
      if (!eventStoreEntry) {
        eventLaneEventNotRegisteredError.throw({ eventId: message.eventId });
      }

      verifyRemoteLaneToken({
        laneId: message.laneId,
        bindingAuth: this.resolveBindingAuth(message.laneId),
        token: message.authToken ?? "",
        requiredCapability: "produce",
      });

      const payload = this.dependencies.serializer.parse(message.payload);
      const relaySourceId = `${this.context.relaySourcePrefix}${this.context.profile}:${message.laneId}:local-simulated`;
      await this.diagnostics.logRelayEmit({
        messageId: message.id,
        eventId: message.eventId,
        laneId: message.laneId,
        profile: this.context.profile,
        relaySourceId,
      });
      await withEventLaneAsyncContexts({
        lane: eventRoute?.lane,
        serializedAsyncContexts: message.serializedAsyncContexts,
        store: this.dependencies.store,
        serializer: this.dependencies.serializer,
        fn: async () =>
          await this.dependencies.eventManager.emit(
            eventStoreEntry!.event,
            payload,
            runtimeSource.runtime(relaySourceId),
          ),
      });
    } catch (error) {
      await this.dependencies.logger.error(
        "Event lane simulated consume failed.",
        {
          laneId: message.laneId,
          eventId: message.eventId,
          error: error instanceof Error ? error : new Error(String(error)),
        },
      );
    }
  }

  private resolveBindingAuth(
    laneId: string,
  ): RemoteLaneBindingAuth | undefined {
    return (
      this.context.bindingsByLaneId.get(laneId)?.auth ??
      this.bindingAuthByLaneId.get(laneId)
    );
  }
}
