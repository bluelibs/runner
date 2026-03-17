import { defineEvent } from "../../../define";
import { Logger } from "../../../models/Logger";
import { EventManager } from "../../../models/EventManager";
import { Serializer } from "../../../serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import { r } from "../../..";
import { EventLanesDiagnostics } from "../../event-lanes/EventLanesDiagnostics";
import { LocalSimulatedEventLaneTransport } from "../../event-lanes/LocalSimulatedEventLaneTransport";
import type { EventLanesResourceContext } from "../../event-lanes/EventLanesInternals";
import type { EventLaneMessage } from "../../event-lanes/types";

function createLogger() {
  return new Logger({
    printThreshold: null,
    printStrategy: "json",
    bufferLogs: false,
    useColors: false,
  });
}

function createContext(): EventLanesResourceContext {
  return {
    started: false,
    coolingDown: false,
    disposed: false,
    activeBindingsByQueue: new Map(),
    hookAllowlistByLaneId: new Map(),
    bindingsByLaneId: new Map(),
    eventRouteByEventId: new Map(),
    queues: new Set(),
    managedQueues: new Set(),
    relaySourcePrefix: "runner.event-lanes.relay:",
    profile: "tests",
  };
}

async function relay(
  transport: LocalSimulatedEventLaneTransport,
  message: EventLaneMessage,
) {
  const relayInternal = transport as unknown as {
    relay(message: EventLaneMessage): Promise<void>;
  };

  await relayInternal.relay(message);
}

describe("eventLanes async context helpers", () => {
  it("rehydrates allowlisted async contexts during local-simulated relay", async () => {
    const allowedContext = r
      .asyncContext<{ value: string }>("tests-event-lanes-relay-allowed")
      .build();
    const blockedContext = r
      .asyncContext<{ value: string }>("tests-event-lanes-relay-blocked")
      .build();
    const serializer = new Serializer();
    const event = defineEvent<{ value: number }>({
      id: "tests-event-lanes-relay-event",
    });
    const eventManager = new EventManager();
    const logger = createLogger();
    jest.spyOn(logger, "error").mockResolvedValue();

    const seen = {
      allowed: "missing",
      blocked: "missing",
    };

    eventManager.addListener(event, async () => {
      try {
        seen.allowed = allowedContext.use().value;
      } catch {
        seen.allowed = "missing";
      }

      try {
        seen.blocked = blockedContext.use().value;
      } catch {
        seen.blocked = "missing";
      }
    });

    const context = createContext();
    context.eventRouteByEventId.set(event.id, {
      lane: {
        id: "tests-event-lanes-relay-lane",
        asyncContexts: [allowedContext.id],
      },
    } as any);

    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer,
        store: {
          events: new Map([[event.id, { event }]]),
          asyncContexts: new Map([
            [allowedContext.id, allowedContext],
            [blockedContext.id, blockedContext],
          ]),
        } as any,
        logger,
      },
      context,
      new EventLanesDiagnostics(logger, true),
    );

    let message: EventLaneMessage | undefined;
    await allowedContext.provide({ value: "A" }, async () =>
      blockedContext.provide({ value: "B" }, async () => {
        message = {
          id: "sim-1",
          laneId: "tests-event-lanes-relay-lane",
          eventId: event.id,
          payload: serializer.stringify({ value: 1 }),
          serializedAsyncContexts: serializer.stringify({
            [allowedContext.id]: allowedContext.serialize({ value: "A" }),
          }),
          source: runtimeSource.task("tests-event-lanes-relay-source"),
          createdAt: new Date(),
          attempts: 1,
          maxAttempts: 1,
        };
      }),
    );

    await relay(transport, message!);

    expect(seen).toEqual({
      allowed: "A",
      blocked: "missing",
    });
  });
});
