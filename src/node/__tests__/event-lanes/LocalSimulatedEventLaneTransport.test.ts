import { defineEvent } from "../../../define";
import { Logger } from "../../../models/Logger";
import { Serializer } from "../../../serializer/Serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import { EventManager } from "../../../models/EventManager";
import type { Store } from "../../../models/Store";
import { EventLanesDiagnostics } from "../../event-lanes/EventLanesDiagnostics";
import { LocalSimulatedEventLaneTransport } from "../../event-lanes/LocalSimulatedEventLaneTransport";
import type { EventLanesResourceContext } from "../../event-lanes/EventLanesInternals";
import type { EventLaneMessage } from "../../event-lanes/types";
import { issueRemoteLaneToken } from "../../remote-lanes/laneAuth";

function createContext(
  overrides: Partial<
    Pick<EventLanesResourceContext, "coolingDown" | "disposed">
  > = {},
): EventLanesResourceContext {
  return {
    started: false,
    coolingDown: false,
    disposed: false,
    activeBindingsByQueue: new Map(),
    bindingsByLaneId: new Map(),
    eventRouteByEventId: new Map(),
    queues: new Set(),
    managedQueues: new Set(),
    relaySourcePrefix: "runner.event-lanes.relay:",
    profile: "tests",
    ...overrides,
  };
}

function createMessage(
  eventId = "tests.local-simulated.event",
): EventLaneMessage {
  return {
    id: "sim-1",
    laneId: "tests.local-simulated.lane",
    eventId,
    payload: JSON.stringify({ value: 1 }),
    source: runtimeSource.task("tests.local-simulated.source"),
    createdAt: new Date(),
    attempts: 1,
    maxAttempts: 1,
  };
}

function createLogger() {
  return new Logger({
    printThreshold: null,
    printStrategy: "json",
    bufferLogs: false,
    useColors: false,
  });
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

describe("LocalSimulatedEventLaneTransport", () => {
  it("returns early while cooling down or disposed", async () => {
    const logger = createLogger();
    const errorSpy = jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const context = createContext({ coolingDown: true, disposed: false });
    const store = { events: new Map() } as unknown as Store;
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store,
        logger,
      },
      context,
      diagnostics,
    );

    await relay(transport, createMessage());
    expect(emitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    context.coolingDown = false;
    context.disposed = true;
    await relay(transport, createMessage());
    expect(emitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs when message event is no longer registered", async () => {
    const logger = createLogger();
    const errorSpy = jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const store = { events: new Map() } as unknown as Store;
    const context = createContext();
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store,
        logger,
      },
      context,
      diagnostics,
    );

    await relay(transport, createMessage("tests.local-simulated.missing"));
    expect(emitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Event lane simulated consume failed.",
      expect.objectContaining({
        laneId: "tests.local-simulated.lane",
        eventId: "tests.local-simulated.missing",
        error: expect.any(Error),
      }),
    );
  });

  it("relays parsed payload to event manager when event is present", async () => {
    const logger = createLogger();
    jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const context = createContext();
    const event = defineEvent<{ value: number }>({
      id: "tests.local-simulated.present",
    });
    const store = {
      events: new Map([[event.id, { event }]]),
    } as unknown as Store;
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store,
        logger,
      },
      context,
      diagnostics,
    );

    await relay(transport, createMessage(event.id));
    expect(emitSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      expect.objectContaining({
        kind: "runtime",
        id: expect.stringContaining(":local-simulated"),
      }),
    );
  });

  it("wraps non-Error relay failures before logging", async () => {
    const logger = createLogger();
    const errorSpy = jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const context = createContext();
    const event = defineEvent<{ value: number }>({
      id: "tests.local-simulated.parse-failure",
    });
    const serializer = new Serializer();
    jest.spyOn(serializer, "parse").mockImplementation(() => {
      throw "parse-failed";
    });
    const store = {
      events: new Map([[event.id, { event }]]),
    } as unknown as Store;
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer,
        store,
        logger,
      },
      context,
      diagnostics,
    );

    await relay(transport, createMessage(event.id));
    expect(errorSpy).toHaveBeenCalledWith(
      "Event lane simulated consume failed.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
    const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    const loggedError = lastCall?.[1]?.error;
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe("parse-failed");
  });

  it("uses fallback binding-auth map when context binding lookup misses", async () => {
    const logger = createLogger();
    jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const context = createContext();
    const laneId = "tests.local-simulated.fallback-auth.lane";
    const event = defineEvent<{ value: number }>({
      id: "tests.local-simulated.fallback-auth.event",
    });
    context.eventRouteByEventId.set(event.id, {
      lane: { id: laneId },
      orderingKey: undefined,
      metadata: undefined,
    } as any);
    const store = {
      events: new Map([[event.id, { event }]]),
    } as unknown as Store;
    const bindingAuth = { secret: "fallback-secret" };
    const token = issueRemoteLaneToken({
      laneId,
      bindingAuth,
      capability: "produce",
    });
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store,
        logger,
      },
      context,
      diagnostics,
      new Map([[laneId, bindingAuth]]),
    );

    await relay(transport, {
      ...createMessage(event.id),
      laneId,
      authToken: token,
    });
    expect(emitSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      expect.objectContaining({ kind: "runtime" }),
    );
  });

  it("falls back to no lane policy when lane id is not found in routing table", async () => {
    const logger = createLogger();
    jest.spyOn(logger, "error").mockResolvedValue();
    const eventManager = new EventManager();
    const emitSpy = jest.spyOn(eventManager, "emit").mockResolvedValue();
    const diagnostics = new EventLanesDiagnostics(logger, true);
    const context = createContext();
    const event = defineEvent<{ value: number }>({
      id: "tests.local-simulated.policy-miss.event",
    });
    context.eventRouteByEventId.set(event.id, {
      lane: { id: "tests.local-simulated.policy-miss.other-lane" },
      orderingKey: undefined,
      metadata: undefined,
    } as any);
    const store = {
      events: new Map([[event.id, { event }]]),
    } as unknown as Store;
    const transport = new LocalSimulatedEventLaneTransport(
      {
        eventManager,
        serializer: new Serializer(),
        store,
        logger,
      },
      context,
      diagnostics,
    );

    await relay(transport, {
      ...createMessage(event.id),
      laneId: "tests.local-simulated.policy-miss.target-lane",
      authToken: undefined,
    });
    expect(emitSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      expect.objectContaining({ kind: "runtime" }),
    );
  });
});
