import { EventManager } from "../../../models/EventManager";
import { runtimeSource } from "../../../types/runtimeSource";
import { consumeEventLaneQueueMessage } from "../../event-lanes/eventLanes.consumer";

describe("eventLanes.consumer", () => {
  it("uses the default retry delay when a requeueable failure occurs", async () => {
    const emitError = new Error("emit failed");
    const queue = {
      ack: jest.fn(async () => undefined),
      nack: jest.fn(async () => undefined),
      consume: jest.fn(async () => undefined),
    };

    const logger = {
      error: jest.fn(async () => undefined),
    };

    await consumeEventLaneQueueMessage({
      config: {
        profile: "worker",
        mode: "network",
        topology: {
          profiles: {
            worker: { consume: [] },
          },
          bindings: [],
        },
      } as any,
      dependencies: {
        eventManager: {
          emit: jest.fn(async () => {
            throw emitError;
          }),
        } as unknown as EventManager,
        store: {
          events: new Map([
            [
              "tests-event-lanes-consumer-event",
              {
                event: {
                  id: "tests-event-lanes-consumer-event",
                },
              },
            ],
          ]),
          asyncContexts: new Map(),
        } as any,
        serializer: {
          parse: JSON.parse,
        } as any,
        logger: logger as any,
      },
      context: {
        profile: "worker",
        coolingDown: false,
        disposed: false,
        bindingsByLaneId: new Map([
          [
            "tests-event-lanes-consumer-lane",
            {
              lane: { id: "tests-event-lanes-consumer-lane" },
              retryDelayMs: 1,
            },
          ],
        ]),
        relaySourcePrefix: "relay:",
      } as any,
      diagnostics: {
        logRelayEmit: jest.fn(async () => undefined),
        logSkipInactiveLane: jest.fn(async () => undefined),
      } as any,
      queue,
      activeLaneIds: new Set(["tests-event-lanes-consumer-lane"]),
      message: {
        id: "tests-event-lanes-consumer-message",
        laneId: "tests-event-lanes-consumer-lane",
        eventId: "tests-event-lanes-consumer-event",
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.consumer"),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 2,
      },
    });

    expect(queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      true,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed; message requeued for retry.",
      expect.objectContaining({
        error: emitError,
      }),
    );
  });
});
