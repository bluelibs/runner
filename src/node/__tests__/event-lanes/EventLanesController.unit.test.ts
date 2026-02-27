import { EventLanesController } from "../../event-lanes/EventLanesController";
import { runtimeSource } from "../../../types/runtimeSource";

describe("EventLanesController unit coverage", () => {
  const createBaseConfig = (): any => ({
    profile: "unit",
    mode: "network",
    topology: {
      profiles: {
        unit: { consume: [] },
      },
      bindings: [],
    },
  });

  it("registers producer interceptor only once per controller instance", () => {
    const eventManager = {
      intercept: jest.fn(),
      addListener: jest.fn(),
    };

    const controller = new EventLanesController(
      createBaseConfig(),
      {
        eventManager: eventManager as any,
        serializer: { stringify: JSON.stringify, parse: JSON.parse } as any,
        store: { events: new Map() } as any,
        logger: { error: jest.fn() } as any,
      },
      {
        profile: "unit",
        started: false,
        coolingDown: false,
        disposed: false,
        activeBindingsByQueue: new Map(),
        bindingsByLaneId: new Map(),
        eventRouteByEventId: new Map(),
        queues: new Set(),
        managedQueues: new Set(),
        relaySourcePrefix: "relay:",
      } as any,
      {
        logEnqueue: async () => undefined,
        logRelayEmit: async () => undefined,
        logSkipInactiveLane: async () => undefined,
      } as any,
    );

    (controller as any).registerProducerInterceptor();
    (controller as any).registerProducerInterceptor();

    expect(eventManager.intercept).toHaveBeenCalledTimes(1);
  });

  it("normalizes primitive DLQ enqueue failures and still nacks the source message", async () => {
    const logger = { error: jest.fn(async () => undefined) };
    const queue = {
      ack: jest.fn(async () => undefined),
      nack: jest.fn(async () => undefined),
    };
    const dlqQueue = {
      enqueue: jest.fn(async () => {
        throw "dlq-primitive";
      }),
    };

    const controller = new EventLanesController(
      createBaseConfig(),
      {
        eventManager: {
          emit: jest.fn(async () => {
            throw new Error("emit failed");
          }),
          intercept: jest.fn(),
          addListener: jest.fn(),
        } as any,
        serializer: {
          stringify: JSON.stringify,
          parse: JSON.parse,
        } as any,
        store: {
          events: new Map([
            [
              "unit.event",
              {
                event: { id: "unit.event" },
              },
            ],
          ]),
        } as any,
        logger: logger as any,
      },
      {
        profile: "unit",
        started: true,
        coolingDown: false,
        disposed: false,
        activeBindingsByQueue: new Map(),
        bindingsByLaneId: new Map([
          [
            "lane.unit",
            {
              lane: { id: "lane.unit" },
              queue,
              dlq: { queue: dlqQueue },
            },
          ],
        ]),
        eventRouteByEventId: new Map(),
        queues: new Set(),
        managedQueues: new Set(),
        relaySourcePrefix: "relay:",
      } as any,
      {
        logEnqueue: async () => undefined,
        logRelayEmit: async () => undefined,
        logSkipInactiveLane: async () => undefined,
      } as any,
    );

    await (controller as any).consumeQueueMessage(
      queue,
      new Set(["lane.unit"]),
      {
        id: "message-1",
        laneId: "lane.unit",
        eventId: "unit.event",
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.unit"),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 1,
      },
    );

    expect(queue.nack).toHaveBeenCalledWith("message-1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed to enqueue message into DLQ.",
      expect.objectContaining({
        laneId: "lane.unit",
        eventId: "unit.event",
        error: expect.any(Error),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed.",
      expect.objectContaining({
        data: { dlqEnqueueError: "dlq-primitive" },
      }),
    );
  });

  it("preserves Error instances from DLQ enqueue failures", async () => {
    const logger = { error: jest.fn(async () => undefined) };
    const queue = {
      ack: jest.fn(async () => undefined),
      nack: jest.fn(async () => undefined),
    };
    const dlqError = new Error("dlq-error-instance");
    const dlqQueue = {
      enqueue: jest.fn(async () => {
        throw dlqError;
      }),
    };

    const controller = new EventLanesController(
      createBaseConfig(),
      {
        eventManager: {
          emit: jest.fn(async () => {
            throw new Error("emit failed");
          }),
          intercept: jest.fn(),
          addListener: jest.fn(),
        } as any,
        serializer: {
          stringify: JSON.stringify,
          parse: JSON.parse,
        } as any,
        store: {
          events: new Map([
            [
              "unit.event.error",
              {
                event: { id: "unit.event.error" },
              },
            ],
          ]),
        } as any,
        logger: logger as any,
      },
      {
        profile: "unit",
        started: true,
        coolingDown: false,
        disposed: false,
        activeBindingsByQueue: new Map(),
        bindingsByLaneId: new Map([
          [
            "lane.unit.error",
            {
              lane: { id: "lane.unit.error" },
              queue,
              dlq: { queue: dlqQueue },
            },
          ],
        ]),
        eventRouteByEventId: new Map(),
        queues: new Set(),
        managedQueues: new Set(),
        relaySourcePrefix: "relay:",
      } as any,
      {
        logEnqueue: async () => undefined,
        logRelayEmit: async () => undefined,
        logSkipInactiveLane: async () => undefined,
      } as any,
    );

    await (controller as any).consumeQueueMessage(
      queue,
      new Set(["lane.unit.error"]),
      {
        id: "message-2",
        laneId: "lane.unit.error",
        eventId: "unit.event.error",
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.unit.error"),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 1,
      },
    );

    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed to enqueue message into DLQ.",
      expect.objectContaining({
        error: dlqError,
      }),
    );
  });
});
