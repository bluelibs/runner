import { defineEvent } from "../../../define";
import { EventManager } from "../../../models/EventManager";
import { Logger } from "../../../models/Logger";
import { Serializer } from "../../../serializer/Serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import { EventLanesDiagnostics } from "../../event-lanes/EventLanesDiagnostics";
import { LocalSimulatedEventLaneTransport } from "../../event-lanes/LocalSimulatedEventLaneTransport";
import type { EventLanesResourceContext } from "../../event-lanes/EventLanesInternals";
import type { EventLaneMessage } from "../../event-lanes/types";
import { hashEventLaneAuthPayload } from "../../event-lanes/eventLanes.auth";
import { issueRemoteLaneToken } from "../../remote-lanes/laneAuth";

describe("LocalSimulatedEventLaneTransport auth hash", () => {
  it("rejects a rewritten serialized async context blob", async () => {
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "json",
      bufferLogs: false,
      useColors: false,
    });
    const errorSpy = jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest
      .spyOn(eventManager, "emit")
      .mockResolvedValue(undefined);
    const event = defineEvent<{ value: number }>({
      id: "tests-local-simulated-auth-event",
    });
    const laneId = "tests.local-simulated.auth.lane";
    const context = {
      started: false,
      coolingDown: false,
      disposed: false,
      activeBindingsByQueue: new Map(),
      consumedLaneIds: new Set(),
      hookAllowlistByLaneId: new Map(),
      bindingsByLaneId: new Map(),
      eventRouteByEventId: new Map([[event.id, { lane: { id: laneId } }]]),
      queues: new Set(),
      managedQueues: new Set(),
      relaySourcePrefix: "runner.event-lanes.relay:",
      profile: "tests",
    } as unknown as EventLanesResourceContext;
    const bindingAuth = { secret: "local-simulated-auth-secret" };
    const payload = JSON.stringify({ value: 1 });
    const serializedAsyncContexts = JSON.stringify({ tenant: "acme" });
    const token = issueRemoteLaneToken({
      laneId,
      bindingAuth,
      capability: "produce",
      target: {
        kind: "event-lane",
        targetId: event.id,
        payloadHash: hashEventLaneAuthPayload(payload, serializedAsyncContexts),
      },
    });

    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store: {
          events: new Map([[event.id, { event }]]),
          asyncContexts: new Map(),
        } as never,
        logger,
      },
      context,
      new EventLanesDiagnostics(logger, true),
      new Map([[laneId, bindingAuth]]),
    );

    const message: EventLaneMessage = {
      id: "sim-auth-1",
      laneId,
      eventId: event.id,
      payload,
      serializedAsyncContexts: JSON.stringify({ tenant: "evil" }),
      source: runtimeSource.task("tests.local-simulated.auth.source"),
      authToken: token,
      createdAt: new Date(),
      attempts: 1,
    };

    await (
      transport as unknown as {
        relay(message: EventLaneMessage): Promise<void>;
      }
    ).relay(message);

    expect(emitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
