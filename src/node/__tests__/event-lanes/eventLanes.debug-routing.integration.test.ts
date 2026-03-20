import { genericError } from "../../../errors";
import { r, resources, run } from "../../..";
import { runtimeSource } from "../../../types/runtimeSource";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class DebugRoutingQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;
  private inFlight = new Map<string, EventLaneMessage>();

  public enqueued: EventLaneMessage[] = [];
  public nacks: Array<{ messageId: string; requeue: boolean }> = [];

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `debug-lane-${++this.seq}`;
    const full: EventLaneMessage = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };
    this.enqueued.push(full);
    setImmediate(() => void this.process());
    return id;
  }

  async consume(handler: (message: EventLaneMessage) => Promise<void>) {
    this.handler = handler;
    setImmediate(() => void this.process());
  }

  async ack(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
    setImmediate(() => void this.process());
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    this.nacks.push({ messageId, requeue });
    const message = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (requeue && message) {
      this.enqueued.push(message);
    }
    setImmediate(() => void this.process());
  }

  async dispose(): Promise<void> {
    this.handler = null;
    this.enqueued = [];
    this.inFlight.clear();
  }

  async deliver(message: EventLaneMessage): Promise<void> {
    if (!this.handler) {
      throw genericError.new({ message: "Queue consumer not initialized" });
    }
    await this.handler(message);
  }

  private async process(): Promise<void> {
    const handler = this.handler;
    if (!handler || this.enqueued.length === 0) {
      return;
    }

    while (this.enqueued.length > 0) {
      const raw = this.enqueued.shift()!;
      const message: EventLaneMessage = {
        ...raw,
        attempts: raw.attempts + 1,
      };
      this.inFlight.set(message.id, message);
      await handler(message);
    }
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw genericError.new({ message: "waitUntil timed out" });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type CapturedLog = {
  level: string;
  message: string;
  source?: string;
  data?: Record<string, unknown>;
};

describe("event-lanes: debug routing logs", () => {
  it("logs enqueue, relay, and inactive-lane skip when debug event logging is enabled", async () => {
    const queue = new DebugRoutingQueue();
    const logs: CapturedLog[] = [];

    const logCollector = r
      .resource("tests-event-lanes-debug-routing-logCollector")
      .dependencies({ logger: resources.logger })
      .init(async (_config, { logger }) => {
        logger.onLog((log) => {
          logs.push({
            level: log.level,
            message: String(log.message),
            source: log.source,
            data: log.data,
          });
        });
      })
      .build();

    const event = r
      .event<{ id: string }>("tests-event-lanes-debug-routing-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-debug-routing-lane")
      .applyTo([event])
      .build();

    let hookCalls = 0;
    const hook = r
      .hook("tests-event-lanes-debug-routing-hook")
      .on(event)
      .run(async () => {
        hookCalls += 1;
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-debug-routing-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "evt-1" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-debug-routing-app")
      .register([
        logCollector,
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .dependencies({ logCollector, emitTask })
      .build();

    const runtime = await run(app, {
      debug: { logEventEmissionOnRun: true, logEventEmissionInput: false },
      logs: { bufferLogs: true },
    });

    await runtime.runTask(emitTask);
    await waitUntil(() => hookCalls === 1);

    await queue.deliver({
      id: "inactive-msg-1",
      laneId: "tests.event-lanes.debug-routing.other-lane",
      eventId: "tests.event-lanes.debug-routing.unknown",
      payload: "{}",
      source: runtimeSource.runtime("tests.event-lanes.debug-routing"),
      createdAt: new Date(),
      attempts: 1,
    });

    await waitUntil(() =>
      logs.some((log) => log.message === "event-lanes.skip-inactive-lane"),
    );

    const laneLogs = logs.filter((log) =>
      log.message.startsWith("event-lanes."),
    );

    const enqueueLog = laneLogs.find(
      (log) => log.message === "event-lanes.enqueue",
    );
    const relayLog = laneLogs.find(
      (log) => log.message === "event-lanes.relay-emit",
    );
    const skipLog = laneLogs.find(
      (log) => log.message === "event-lanes.skip-inactive-lane",
    );

    expect(enqueueLog).toBeTruthy();
    expect(enqueueLog?.data).toMatchObject({
      eventId: runtime.store.findIdByDefinition(event),
      laneId: lane.id,
      profile: "worker",
      mode: "network",
      routingDecision: "direct-emission-intercepted-enqueued",
    });

    expect(relayLog).toBeTruthy();
    expect(relayLog?.data).toMatchObject({
      eventId: runtime.store.findIdByDefinition(event),
      laneId: lane.id,
      profile: "worker",
      relaySourceId:
        "runner.event-lanes.relay:worker:tests-event-lanes-debug-routing-lane",
    });

    expect(skipLog).toBeTruthy();
    expect(skipLog?.data).toMatchObject({
      messageId: "inactive-msg-1",
      laneId: "tests.event-lanes.debug-routing.other-lane",
      profile: "worker",
      routingDecision: "lane-not-consumed-by-profile",
      nackRequeue: true,
    });
    expect(skipLog?.data?.activeLaneIds).toEqual([lane.id]);
    expect(queue.nacks).toContainEqual({
      messageId: "inactive-msg-1",
      requeue: true,
    });

    await runtime.dispose();
  });

  it("does not log lane diagnostics when logEventEmissionOnRun is false", async () => {
    const queue = new DebugRoutingQueue();
    const logs: CapturedLog[] = [];

    const logCollector = r
      .resource("tests-event-lanes-debug-routing-disabled-logCollector")
      .dependencies({ logger: resources.logger })
      .init(async (_config, { logger }) => {
        logger.onLog((log) => {
          logs.push({
            level: log.level,
            message: String(log.message),
            source: log.source,
            data: log.data,
          });
        });
      })
      .build();

    const event = r
      .event<{ id: string }>("tests-event-lanes-debug-routing-disabled-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-debug-routing-disabled-lane")
      .applyTo([event])
      .build();
    const emitTask = r
      .task("tests-event-lanes-debug-routing-disabled-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "evt-disabled" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-debug-routing-disabled-app")
      .register([
        logCollector,
        event,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .dependencies({ logCollector, emitTask })
      .build();

    const runtime = await run(app, {
      debug: { logEventEmissionOnRun: false, logEventEmissionInput: false },
      logs: { bufferLogs: true },
    });
    await runtime.runTask(emitTask);

    await waitUntil(() => queue.enqueued.length >= 1);
    expect(logs.some((log) => log.message.startsWith("event-lanes."))).toBe(
      false,
    );

    await runtime.dispose();
  });
});
