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

  it("nacks without requeue when attempts are exhausted", async () => {
    const logger = { error: jest.fn(async () => undefined) };
    const queue = {
      ack: jest.fn(async () => undefined),
      nack: jest.fn(async () => undefined),
    };
    const emitError = new Error("emit failed");

    const controller = new EventLanesController(
      createBaseConfig(),
      {
        eventManager: {
          emit: jest.fn(async () => {
            throw emitError;
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
              "unit-event",
              {
                event: { id: "unit-event" },
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
            "lane-unit",
            {
              lane: { id: "lane-unit" },
              queue,
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
      new Set(["lane-unit"]),
      {
        id: "message-1",
        laneId: "lane-unit",
        eventId: "unit-event",
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.unit"),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 1,
      },
    );

    expect(queue.nack).toHaveBeenCalledWith("message-1", false);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed.",
      expect.objectContaining({
        laneId: "lane-unit",
        eventId: "unit-event",
        error: emitError,
        data: expect.objectContaining({
          attempts: 1,
          maxAttempts: 1,
        }),
      }),
    );
  });

  it("requeues for retry before maxAttempts is reached", async () => {
    const logger = { error: jest.fn(async () => undefined) };
    const queue = {
      ack: jest.fn(async () => undefined),
      nack: jest.fn(async () => undefined),
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
              "unit-event-retry",
              {
                event: { id: "unit-event-retry" },
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
            "lane-unit-retry",
            {
              lane: { id: "lane-unit-retry" },
              queue,
              retryDelayMs: 1,
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
      new Set(["lane-unit-retry"]),
      {
        id: "message-retry",
        laneId: "lane-unit-retry",
        eventId: "unit-event-retry",
        payload: JSON.stringify({ ok: true }),
        source: runtimeSource.runtime("tests.event-lanes.unit.retry"),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 2,
      },
    );

    expect(queue.nack).toHaveBeenCalledWith("message-retry", true);
    expect(logger.error).toHaveBeenCalledWith(
      "Event lane consumer failed; message requeued for retry.",
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: 1,
          maxAttempts: 2,
        }),
      }),
    );
  });

  it("routes producer emissions by raw ids when stored event resolution misses", async () => {
    const queue = {
      enqueue: jest.fn(async () => undefined),
    };
    const intercept = jest.fn();
    const controller = new EventLanesController(
      createBaseConfig(),
      {
        eventManager: {
          intercept,
          addListener: jest.fn(),
        } as any,
        serializer: {
          stringify: JSON.stringify,
          parse: JSON.parse,
        } as any,
        store: {
          events: new Map(),
          toPublicId: (id: string) => id,
        } as any,
        logger: { error: jest.fn(async () => undefined) } as any,
      },
      {
        profile: "unit",
        started: false,
        coolingDown: false,
        disposed: false,
        activeBindingsByQueue: new Map(),
        bindingsByLaneId: new Map([
          [
            "lane-unit-raw",
            {
              lane: { id: "lane-unit-raw" },
              queue,
            },
          ],
        ]),
        eventRouteByEventId: new Map([
          [
            "unit-raw-event",
            {
              lane: { id: "lane-unit-raw" },
            },
          ],
        ]),
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
    const interceptor = intercept.mock.calls[0][0];
    const next = jest.fn(async () => "next-result");
    const stopPropagation = jest.fn();

    await interceptor(next, {
      id: "unit-raw-event",
      data: { ok: true },
      source: runtimeSource.runtime("tests.event-lanes.unit.raw"),
      stopPropagation,
    });

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
