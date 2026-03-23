import { EventManager } from "../../../models/EventManager";
import { createRemoteLaneReplayProtector } from "../../remote-lanes/laneAuth";
import { runtimeSource } from "../../../types/runtimeSource";
import { consumeEventLaneQueueMessage } from "../../event-lanes/eventLanes.consumer";

const laneId = "tests-event-lanes-consumer-lane";
const otherLaneId = "tests-event-lanes-consumer-other-lane";
const eventId = "tests-event-lanes-consumer-event";

function createBaseOptions(overrides: Record<string, unknown> = {}) {
  const queue = {
    ack: jest.fn(async () => undefined),
    nack: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
  };
  const logger = {
    error: jest.fn(async () => undefined),
  };
  const eventManager = {
    emit: jest.fn(async () => undefined),
  } as unknown as EventManager;

  return {
    queue,
    logger,
    eventManager,
    options: {
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
        eventManager,
        store: {
          events: new Map([[eventId, { event: { id: eventId } }]]),
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
            laneId,
            {
              lane: { id: laneId },
              retryDelayMs: 1,
              maxAttempts: 2,
            },
          ],
        ]),
        eventRouteByEventId: new Map([[eventId, { lane: { id: laneId } }]]),
        relaySourcePrefix: "relay:",
        replayProtector: createRemoteLaneReplayProtector(),
      } as any,
      diagnostics: {
        logRelayEmit: jest.fn(async () => undefined),
        logSkipInactiveLane: jest.fn(async () => undefined),
      } as any,
      queue,
      activeLaneIds: new Set([laneId]),
      message: {
        id: "tests-event-lanes-consumer-message",
        laneId,
        eventId,
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.consumer"),
        createdAt: new Date(),
        attempts: 1,
      },
      ...overrides,
    },
  };
}

describe("eventLanes.consumer", () => {
  it("requeues retryable event handler failures", async () => {
    const emitError = new Error("emit failed");
    const { queue, logger, eventManager, options } = createBaseOptions();
    jest.spyOn(eventManager, "emit").mockRejectedValue(emitError);

    await consumeEventLaneQueueMessage(options as any);

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

  it("rejects messages whose event is assigned to a different lane", async () => {
    const { queue, logger, eventManager, options } = createBaseOptions({
      context: {
        profile: "worker",
        coolingDown: false,
        disposed: false,
        bindingsByLaneId: new Map([
          [
            laneId,
            {
              lane: { id: laneId },
              maxAttempts: 3,
            },
          ],
        ]),
        eventRouteByEventId: new Map([
          [eventId, { lane: { id: otherLaneId } }],
        ]),
        relaySourcePrefix: "relay:",
        replayProtector: createRemoteLaneReplayProtector(),
      } as any,
    });

    await consumeEventLaneQueueMessage(options as any);

    expect(eventManager.emit).not.toHaveBeenCalled();
    expect(queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      false,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "eventLanes-assignmentMismatch",
        }),
      }),
    );
  });

  it("rejects messages whose event has no assigned lane route", async () => {
    const { queue, logger, eventManager, options } = createBaseOptions({
      context: {
        profile: "worker",
        coolingDown: false,
        disposed: false,
        bindingsByLaneId: new Map([
          [
            laneId,
            {
              lane: { id: laneId },
              maxAttempts: 3,
            },
          ],
        ]),
        eventRouteByEventId: new Map(),
        relaySourcePrefix: "relay:",
        replayProtector: createRemoteLaneReplayProtector(),
      } as any,
    });

    await consumeEventLaneQueueMessage(options as any);

    expect(eventManager.emit).not.toHaveBeenCalled();
    expect(queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      false,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "eventLanes-assignmentMismatch",
        }),
      }),
    );
  });

  it("rejects messages with invalid auth tokens without retry", async () => {
    const { queue, logger, eventManager, options } = createBaseOptions({
      context: {
        profile: "worker",
        coolingDown: false,
        disposed: false,
        bindingsByLaneId: new Map([
          [
            laneId,
            {
              lane: { id: laneId },
              auth: { secret: "consumer-secret" },
              maxAttempts: 3,
            },
          ],
        ]),
        eventRouteByEventId: new Map([[eventId, { lane: { id: laneId } }]]),
        relaySourcePrefix: "relay:",
        replayProtector: createRemoteLaneReplayProtector(),
      } as any,
      config: {
        profile: "worker",
        mode: "network",
        topology: {
          profiles: {
            worker: { consume: [] },
          },
          bindings: [
            {
              lane: { id: laneId },
              queue: {},
              auth: { secret: "consumer-secret" },
            },
          ],
        },
      } as any,
      message: {
        id: "tests-event-lanes-consumer-message",
        laneId,
        eventId,
        payload: JSON.stringify({ ok: true }),
        authToken: "not-a-jwt",
        source: runtimeSource.runtime("tests.event-lanes.consumer"),
        createdAt: new Date(),
        attempts: 1,
      },
    });

    await consumeEventLaneQueueMessage(options as any);

    expect(eventManager.emit).not.toHaveBeenCalled();
    expect(queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      false,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "remoteLanes-auth-unauthorized",
        }),
      }),
    );
  });

  it("rejects malformed payloads without retry", async () => {
    const setup = createBaseOptions();
    setup.options.dependencies = {
      eventManager: setup.eventManager,
      store: {
        events: new Map([[eventId, { event: { id: eventId } }]]),
        asyncContexts: new Map(),
      } as any,
      serializer: {
        parse: jest.fn(() => {
          throw new Error("parse failed");
        }),
      } as any,
      logger: setup.logger as any,
    };

    await consumeEventLaneQueueMessage(setup.options as any);

    expect(setup.eventManager.emit).not.toHaveBeenCalled();
    expect(setup.queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      false,
    );
    expect(setup.logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "eventLanes-payloadMalformed",
        }),
      }),
    );
  });

  it("normalizes primitive payload parse failures into permanent malformed-payload errors", async () => {
    const setup = createBaseOptions();
    setup.options.dependencies = {
      ...setup.options.dependencies,
      serializer: {
        parse: jest.fn(() => {
          throw "bad-payload";
        }),
      } as any,
    };

    await consumeEventLaneQueueMessage(setup.options as any);

    expect(setup.eventManager.emit).not.toHaveBeenCalled();
    expect(setup.queue.nack).toHaveBeenCalledWith(
      "tests-event-lanes-consumer-message",
      false,
    );
    expect(setup.logger.error).toHaveBeenCalledWith(
      "Event lane consumer rejected a permanent message.",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "eventLanes-payloadMalformed",
        }),
      }),
    );
  });
});
