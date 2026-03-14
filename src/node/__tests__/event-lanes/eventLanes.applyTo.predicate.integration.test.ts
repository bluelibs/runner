import { createMessageError } from "../../../errors";
import { isSameDefinition, r, run } from "../../..";
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

describe("eventLanes applyTo predicate", () => {
  it("routes predicate-matched events through lane producer transport", async () => {
    const queue = new RecordingQueue();
    const event = r
      .event<{ value: number }>("tests-event-lanes-apply-to-predicate-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-apply-to-predicate-lane")
      .applyTo((candidate) => isSameDefinition(candidate, event))
      .build();

    const emitTask = r
      .task("tests-event-lanes-apply-to-predicate-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-apply-to-predicate-app")
      .register([
        event,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    const canonicalEventId = runtime.store.findIdByDefinition(event);

    await waitUntil(() => queue.enqueued.length === 1);
    expect(queue.enqueued[0].eventId).toBe(canonicalEventId);

    await runtime.dispose();
  });

  it("routes only the intended sibling event when local ids collide", async () => {
    const queue = new RecordingQueue();
    const leftEvent = r.event<{ value: number }>("shared-event").build();
    const rightEvent = r.event<{ value: number }>("shared-event").build();
    const lane = r
      .eventLane("tests-event-lanes-apply-to-predicate-shared-event-lane")
      .applyTo((candidate) => isSameDefinition(candidate, rightEvent))
      .build();

    const leftResource = r.resource("left").register([leftEvent]).build();
    const rightResource = r.resource("right").register([rightEvent]).build();

    const emitTask = r
      .task("tests-event-lanes-apply-to-predicate-shared-event-emit")
      .dependencies({ leftEvent, rightEvent })
      .run(async (_input, deps) => {
        await deps.leftEvent({ value: 1 });
        await deps.rightEvent({ value: 2 });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-apply-to-predicate-shared-event-app")
      .register([
        leftResource,
        rightResource,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    const canonicalRightEventId = runtime.store.findIdByDefinition(rightEvent);

    await waitUntil(() => queue.enqueued.length === 1);
    expect(queue.enqueued[0].eventId).toBe(canonicalRightEventId);
    expect(JSON.parse(queue.enqueued[0].payload)).toEqual({ value: 2 });

    await runtime.dispose();
  });
});
