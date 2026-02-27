import type { Logger } from "../../models/Logger";
import type { DebugConfig } from "../../globals/resources/debug";
import type { EventLanesMode } from "./types";

const EVENT_LANES_LOG_SOURCE = "globals.resources.node.eventLanes";

type EventLanesEnqueueLogInput = {
  eventId: string;
  laneId: string;
  profile: string;
  mode: EventLanesMode;
  sourceKind: string;
  sourceId: string;
  orderingKey?: string;
};

type EventLanesRelayLogInput = {
  messageId: string;
  eventId: string;
  laneId: string;
  profile: string;
  relaySourceId: string;
};

type EventLanesSkipInactiveLogInput = {
  messageId: string;
  eventId: string;
  laneId: string;
  profile: string;
  activeLaneIds: string[];
};

export class EventLanesDiagnostics {
  constructor(
    private readonly logger: Logger,
    private readonly enabled: boolean,
  ) {}

  public static fromDebugConfig(
    logger: Logger,
    config?: DebugConfig,
  ): EventLanesDiagnostics {
    return new EventLanesDiagnostics(
      logger,
      config?.logEventEmissionOnRun === true,
    );
  }

  public async logEnqueue(input: EventLanesEnqueueLogInput): Promise<void> {
    await this.log("event-lanes.enqueue", {
      ...input,
      routingDecision: "direct-emission-intercepted-enqueued",
    });
  }

  public async logRelayEmit(input: EventLanesRelayLogInput): Promise<void> {
    await this.log("event-lanes.relay-emit", input);
  }

  public async logSkipInactiveLane(
    input: EventLanesSkipInactiveLogInput,
  ): Promise<void> {
    await this.log("event-lanes.skip-inactive-lane", {
      ...input,
      routingDecision: "lane-not-consumed-by-profile",
      nackRequeue: true,
    });
  }

  private async log(message: string, data: Record<string, unknown>) {
    if (!this.enabled) {
      return;
    }
    await this.logger.info(message, {
      source: EVENT_LANES_LOG_SOURCE,
      data,
    });
  }
}
