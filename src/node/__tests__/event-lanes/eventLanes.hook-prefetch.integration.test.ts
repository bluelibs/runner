import { createMessageError } from "../../../errors";
import { globals, r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class CoverageQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;
  private inFlight = new Map<string, EventLaneMessage>();

  public enqueued: EventLaneMessage[] = [];
  public consumeCalls = 0;
  public prefetchCalls: number[] = [];
  public nackedRequeue = 0;
  public nackedNoRequeue = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `cov-${++this.seq}`;
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
    this.consumeCalls += 1;
    this.handler = handler;
    setImmediate(() => void this.process());
  }

  async ack(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
    setImmediate(() => void this.process());
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const message = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (requeue && message && message.attempts < message.maxAttempts) {
      this.nackedRequeue += 1;
      this.enqueued.push(message);
    } else if (!requeue) {
      this.nackedNoRequeue += 1;
    }
    setImmediate(() => void this.process());
  }

  async setPrefetch(count: number): Promise<void> {
    this.prefetchCalls.push(count);
  }

  async dispose(): Promise<void> {
    // Keep handler for branch coverage: eventLanes resource marks ctx.disposed first.
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
      if (message.attempts > message.maxAttempts) {
        continue;
      }
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
      throw createMessageError("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("event-lanes: hook lanes + prefetch", () => {
  it("filters relay hooks by lane tag and applies binding prefetch", async () => {
    const laneA = r.eventLane("tests.event-lanes.hook-lane.a").build();
    const laneB = r.eventLane("tests.event-lanes.hook-lane.b").build();
    const queue = new CoverageQueue();
    const event = r
      .event<{ id: string }>("tests.event-lanes.hook-lane.event")
      .tags([globals.tags.eventLane.with({ lane: laneA })])
      .build();

    let callsA = 0;
    let callsB = 0;
    const hookA = r
      .hook("tests.event-lanes.hook-lane.hookA")
      .on(event)
      .tags([globals.tags.eventLaneHook.with({ lane: laneA })])
      .run(async () => {
        callsA += 1;
      })
      .build();
    const hookB = r
      .hook("tests.event-lanes.hook-lane.hookB")
      .on(event)
      .tags([globals.tags.eventLaneHook.with({ lane: laneB })])
      .run(async () => {
        callsB += 1;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.hook-lane.emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "1" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.hook-lane.app")
      .register([
        event,
        hookA,
        hookB,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [laneA] } },
            bindings: [{ lane: laneA, queue, prefetch: 6 }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    await waitUntil(() => callsA === 1);

    expect(callsA).toBe(1);
    expect(callsB).toBe(0);
    expect(queue.prefetchCalls).toContain(6);

    await runtime.dispose();
  });

  it("does not start consumers when profile durableWorker flag mismatches", async () => {
    const lane = r.eventLane("tests.event-lanes.durable-worker.lane").build();
    const queue = new CoverageQueue();
    const app = r
      .resource("tests.event-lanes.durable-worker.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          durableWorker: false,
          topology: {
            profiles: {
              worker: { consume: [lane], durableWorker: true },
            },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    expect(queue.consumeCalls).toBe(0);
    await runtime.dispose();
  });

  it("fails fast when profile does not exist", async () => {
    const lane = r.eventLane("tests.event-lanes.profile-missing.lane").build();
    const queue = new CoverageQueue();
    const missingProfile = "missing" as unknown as "default";
    const app = r
      .resource("tests.event-lanes.profile-missing.app")
      .register([
        eventLanesResource.with({
          // Intentional runtime-invalid profile: cast to bypass compile-time key narrowing.
          profile: missingProfile as "default",
          topology: {
            profiles: { default: { consume: [lane] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow('profile "missing"');
  });
});
