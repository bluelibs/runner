import { AsyncResource } from "async_hooks";
import { eventLaneEventNotRegisteredError } from "../../errors";
import { runtimeSource } from "../../types/runtimeSource";
import type { EventManager } from "../../models/EventManager";
import type { Logger } from "../../models/Logger";
import type { Store } from "../../models/Store";
import type { Serializer } from "../../serializer";
import type { EventLaneMessage } from "./types";
import type { EventLanesDiagnostics } from "./EventLanesDiagnostics";
import type { EventLanesResourceContext } from "./EventLanesInternals";
import { isRelayEmission } from "./EventLanesInternals";

type Dependencies = {
  eventManager: EventManager;
  serializer: Serializer;
  store: Store;
  logger: Logger;
};

export class LocalSimulatedEventLaneTransport {
  private sequence = 0;
  private readonly asyncScope = new AsyncResource(
    "runner.eventLanes.localSimulated",
  );

  constructor(
    private readonly dependencies: Dependencies,
    private readonly context: EventLanesResourceContext,
    private readonly diagnostics: EventLanesDiagnostics,
  ) {}

  public register() {
    this.dependencies.eventManager.intercept(async (next, emission) => {
      if (isRelayEmission(emission, this.context.relaySourcePrefix)) {
        return next(emission);
      }

      const eventRoute = this.context.eventRouteByEventId.get(emission.id);
      if (!eventRoute) {
        return next(emission);
      }

      emission.stopPropagation();
      const message: EventLaneMessage = {
        id: `sim-${++this.sequence}`,
        laneId: eventRoute.lane.id,
        eventId: emission.id,
        payload: this.dependencies.serializer.stringify(emission.data),
        source: emission.source,
        orderingKey: eventRoute.orderingKey,
        metadata: eventRoute.metadata,
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 1,
      };

      await this.diagnostics.logEnqueue({
        eventId: emission.id,
        laneId: eventRoute.lane.id,
        profile: this.context.profile,
        mode: "local-simulated",
        sourceKind: emission.source.kind,
        sourceId: emission.source.id,
        orderingKey: eventRoute.orderingKey,
      });

      this.scheduleRelay(message);
    });
  }

  private scheduleRelay(message: EventLaneMessage): void {
    this.asyncScope.runInAsyncScope(() => {
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
      const eventStoreEntry = this.dependencies.store.events.get(
        message.eventId,
      );
      if (!eventStoreEntry) {
        eventLaneEventNotRegisteredError.throw({ eventId: message.eventId });
      }

      const payload = this.dependencies.serializer.parse(message.payload);
      const relaySourceId = `${this.context.relaySourcePrefix}${this.context.profile}:${message.laneId}:local-simulated`;
      await this.diagnostics.logRelayEmit({
        messageId: message.id,
        eventId: message.eventId,
        laneId: message.laneId,
        profile: this.context.profile,
        relaySourceId,
      });
      await this.dependencies.eventManager.emit(
        eventStoreEntry!.event,
        payload,
        runtimeSource.runtime(relaySourceId),
      );
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
}
