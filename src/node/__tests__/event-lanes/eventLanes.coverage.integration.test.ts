import { createMessageError } from "../../../errors";
import { globals, r, run } from "../../..";
import { runtimeSource } from "../../../types/runtimeSource";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class ManualCoverageQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;

  public consumeCalls = 0;
  public prefetchCalls: number[] = [];
  public nacks: Array<{ messageId: string; requeue: boolean }> = [];
  public initCalls = 0;
  public disposeCalls = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `manual-${++this.seq}`;
    if (this.handler) {
      await this.handler({
        ...message,
        id,
        createdAt: new Date(),
        attempts: 1,
      });
    }
    return id;
  }

  async consume(handler: (message: EventLaneMessage) => Promise<void>) {
    this.consumeCalls += 1;
    this.handler = handler;
  }

  async ack(_messageId: string): Promise<void> {
    // no-op
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    this.nacks.push({ messageId, requeue });
  }

  async setPrefetch(count: number): Promise<void> {
    this.prefetchCalls.push(count);
  }

  async init(): Promise<void> {
    this.initCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    // keep handler to allow post-dispose delivery branch coverage
  }

  async deliver(message: EventLaneMessage): Promise<void> {
    if (!this.handler) {
      throw createMessageError("Queue consumer not initialized");
    }
    await this.handler(message);
  }
}

describe("event-lanes: additional coverage", () => {
  it("treats malformed relay ids as non-lane-specific and runs tagged hooks", async () => {
    const laneA = r.eventLane("tests.event-lanes.malformed-relay.a").build();
    const laneB = r.eventLane("tests.event-lanes.malformed-relay.b").build();
    const queue = new ManualCoverageQueue();
    const event = r
      .event<{ id: string }>("tests.event-lanes.malformed-relay.event")
      .tags([globals.tags.eventLane.with({ lane: laneA })])
      .build();

    let callsA = 0;
    let callsB = 0;
    const hookA = r
      .hook("tests.event-lanes.malformed-relay.hook-a")
      .on(event)
      .tags([globals.tags.eventLaneHook.with({ lane: laneA })])
      .run(async () => {
        callsA += 1;
      })
      .build();
    const hookB = r
      .hook("tests.event-lanes.malformed-relay.hook-b")
      .on(event)
      .tags([globals.tags.eventLaneHook.with({ lane: laneB })])
      .run(async () => {
        callsB += 1;
      })
      .build();

    const emitMalformedRelay = r
      .task("tests.event-lanes.malformed-relay.emit")
      .dependencies({ eventManager: globals.resources.eventManager })
      .run(async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { id: "1" },
          runtimeSource.runtime("runner.event-lanes.relay:missing-lane-id"),
        );
      })
      .build();

    const app = r
      .resource("tests.event-lanes.malformed-relay.app")
      .register([
        event,
        hookA,
        hookB,
        emitMalformedRelay,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [laneA] } },
            bindings: [{ lane: laneA, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitMalformedRelay);

    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    await runtime.dispose();
  });

  it("uses binding prefetch and ignores repeated ready", async () => {
    const lane = r.eventLane("tests.event-lanes.prefetch.invalid").build();
    const queue = new ManualCoverageQueue();
    const event = r
      .event("tests.event-lanes.prefetch.invalid.event")
      .tags([globals.tags.eventLane.with({ lane })])
      .build();
    const laneHook = r
      .hook("tests.event-lanes.prefetch.invalid.hook")
      .on(event)
      .tags([globals.tags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();
    const triggerReadyAgain = r
      .task("tests.event-lanes.prefetch.invalid.ready-again")
      .dependencies({ eventManager: globals.resources.eventManager })
      .run(async (_input, deps) => {
        await deps.eventManager.emit(
          globals.events.ready,
          undefined,
          runtimeSource.runtime("tests.event-lanes.ready.again"),
        );
      })
      .build();

    const app = r
      .resource("tests.event-lanes.prefetch.invalid.app")
      .register([
        event,
        laneHook,
        triggerReadyAgain,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue, prefetch: 4 }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    expect(queue.prefetchCalls).toEqual([4]);
    expect(queue.consumeCalls).toBe(1);

    await runtime.runTask(triggerReadyAgain);
    expect(queue.prefetchCalls).toEqual([4]);
    expect(queue.consumeCalls).toBe(1);

    await runtime.dispose();
  });

  it("nacks inactive, unknown, and post-dispose messages as expected", async () => {
    const lane = r
      .eventLane("tests.event-lanes.consumer-branches.lane")
      .build();
    const queue = new ManualCoverageQueue();
    const app = r
      .resource("tests.event-lanes.consumer-branches.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await queue.deliver({
      id: "inactive-lane",
      laneId: "tests.event-lanes.consumer-branches.other-lane",
      eventId: "tests.event-lanes.consumer-branches.unknown-event",
      payload: "{}",
      source: runtimeSource.runtime("tests.event-lanes.consumer-branches"),
      createdAt: new Date(),
      attempts: 1,
      maxAttempts: 1,
    });
    expect(queue.nacks).toContainEqual({
      messageId: "inactive-lane",
      requeue: true,
    });

    await queue.deliver({
      id: "unknown-event",
      laneId: lane.id,
      eventId: "tests.event-lanes.consumer-branches.unknown-event",
      payload: "{}",
      source: runtimeSource.runtime("tests.event-lanes.consumer-branches"),
      createdAt: new Date(),
      attempts: 1,
      maxAttempts: 1,
    });
    expect(queue.nacks).toContainEqual({
      messageId: "unknown-event",
      requeue: false,
    });

    await runtime.dispose();
    await queue.deliver({
      id: "after-dispose",
      laneId: lane.id,
      eventId: "tests.event-lanes.consumer-branches.unknown-event",
      payload: "{}",
      source: runtimeSource.runtime("tests.event-lanes.consumer-branches"),
      createdAt: new Date(),
      attempts: 1,
      maxAttempts: 1,
    });
    expect(queue.nacks).toContainEqual({
      messageId: "after-dispose",
      requeue: true,
    });
  });
});
