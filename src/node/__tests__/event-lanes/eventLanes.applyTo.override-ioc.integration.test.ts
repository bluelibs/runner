import { createMessageError } from "../../../errors";
import { r, run, tags } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class RecordingQueue implements IEventLaneQueue {
  public enqueued: EventLaneMessage[] = [];

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const full: EventLaneMessage = {
      ...message,
      id: `msg-${this.enqueued.length + 1}`,
      createdAt: new Date(),
      attempts: 0,
    };
    this.enqueued.push(full);
    return full.id;
  }

  async consume(): Promise<void> {}
  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
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

describe("eventLanes applyTo override IoC", () => {
  it("routes to applyTo lane even when event is tagged for another lane", async () => {
    const queueA = new RecordingQueue();
    const queueB = new RecordingQueue();

    const laneA = r
      .eventLane("tests.event-lanes.apply-to.override-ioc.a")
      .build();
    const event = r
      .event<{ value: number }>("tests.event-lanes.apply-to.override-ioc.event")
      .tags([tags.eventLane.with({ lane: laneA })])
      .build();
    const laneB = r
      .eventLane("tests.event-lanes.apply-to.override-ioc.b")
      .applyTo([event])
      .build();

    const emitTask = r
      .task("tests.event-lanes.apply-to.override-ioc.emit")
      .dependencies({ event })
      .run(async (_input, deps) => deps.event({ value: 1 }))
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.override-ioc.app")
      .register([
        event,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [
              { lane: laneA, queue: queueA },
              { lane: laneB, queue: queueB },
            ],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(
      () => queueA.enqueued.length + queueB.enqueued.length === 1,
    );
    expect(queueA.enqueued.length).toBe(0);
    expect(queueB.enqueued.length).toBe(1);
    expect(queueB.enqueued[0].eventId).toBe(event.id);

    await runtime.dispose();
  });
});
