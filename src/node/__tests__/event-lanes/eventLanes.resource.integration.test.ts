import { createMessageError } from "../../../errors";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";
import { r, run } from "../../..";

class TestEventLaneQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;
  private inFlight = new Map<string, EventLaneMessage>();

  public enqueued: EventLaneMessage[] = [];
  public consumeCalls = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `msg-${++this.seq}`;
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
      this.enqueued.push(message);
    }
    setImmediate(() => void this.process());
  }

  async dispose(): Promise<void> {
    this.handler = null;
    this.enqueued = [];
    this.inFlight.clear();
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

class CustomPayload {
  constructor(public readonly value: string) {}
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

describe("event-lanes: eventLanesResource", () => {
  it("queues tagged events and prevents local propagation on producer path", async () => {
    const lane = r.eventLane("tests.event-lanes.producer").build();
    const queue = new TestEventLaneQueue();
    const tagged = r
      .event<{ value: string }>("tests.event-lanes.producer.event")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();

    let localHookCalls = 0;
    const hook = r
      .hook("tests.event-lanes.producer.hook")
      .on(tagged)
      .run(async () => {
        localHookCalls += 1;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.producer.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ value: "x" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.producer.app")
      .register([
        tagged,
        hook,
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

    expect(localHookCalls).toBe(0);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0].eventId).toBe(tagged.id);
    expect(queue.enqueued[0].maxAttempts).toBe(1);

    await runtime.dispose();
  });

  it("uses binding maxAttempts on producer-enqueued messages", async () => {
    const lane = r.eventLane("tests.event-lanes.producer.max-attempts").build();
    const queue = new TestEventLaneQueue();
    const tagged = r
      .event("tests.event-lanes.producer.max-attempts.event")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();

    const emitTask = r
      .task("tests.event-lanes.producer.max-attempts.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged();
      })
      .build();

    const app = r
      .resource("tests.event-lanes.producer.max-attempts.app")
      .register([
        tagged,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane, queue, maxAttempts: 3 }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0].maxAttempts).toBe(3);
    await runtime.dispose();
  });

  it("consumes by profile lane references and keeps untagged events local", async () => {
    const laneA = r.eventLane("tests.event-lanes.profile.laneA").build();
    const laneB = r.eventLane("tests.event-lanes.profile.laneB").build();
    const queueA = new TestEventLaneQueue();
    const queueB = new TestEventLaneQueue();

    const taggedA = r
      .event<{ id: string }>("tests.event-lanes.profile.taggedA")
      .tags([r.runner.tags.eventLane.with({ lane: laneA })])
      .build();
    const taggedB = r
      .event<{ id: string }>("tests.event-lanes.profile.taggedB")
      .tags([r.runner.tags.eventLane.with({ lane: laneB })])
      .build();
    const untagged = r
      .event<{ id: string }>("tests.event-lanes.profile.local")
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests.event-lanes.profile.hookA")
      .on(taggedA)
      .run(async (event) => {
        seen.push(`A:${event.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests.event-lanes.profile.hookB")
      .on(taggedB)
      .run(async (event) => {
        seen.push(`B:${event.data.id}`);
      })
      .build();
    const hookLocal = r
      .hook("tests.event-lanes.profile.hookLocal")
      .on(untagged)
      .run(async (event) => {
        seen.push(`L:${event.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.profile.emit")
      .dependencies({ taggedA, taggedB, untagged })
      .run(async (_input, deps) => {
        await deps.taggedA({ id: "1" });
        await deps.taggedB({ id: "2" });
        await deps.untagged({ id: "3" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.profile.app")
      .register([
        taggedA,
        taggedB,
        untagged,
        hookA,
        hookB,
        hookLocal,
        emitTask,
        eventLanesResource.with({
          profile: "worker-a",
          topology: {
            profiles: { "worker-a": { consume: [laneA] } },
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

    await waitUntil(() => seen.includes("A:1"));
    expect(seen).toEqual(expect.arrayContaining(["A:1", "L:3"]));
    expect(seen).not.toContain("B:2");
    expect(queueB.consumeCalls).toBe(0);

    await runtime.dispose();
  });

  it("validates one binding for multiple events assigned to the same lane", async () => {
    const lane = r.eventLane("tests.event-lanes.shared-lane").build();
    const queue = new TestEventLaneQueue();
    const eventA = r
      .event<{ id: string }>("tests.event-lanes.shared-lane.eventA")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();
    const eventB = r
      .event<{ id: string }>("tests.event-lanes.shared-lane.eventB")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();
    const emitTask = r
      .task("tests.event-lanes.shared-lane.emit")
      .dependencies({ eventA, eventB })
      .run(async (_input, deps) => {
        await deps.eventA({ id: "a" });
        await deps.eventB({ id: "b" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.shared-lane.app")
      .register([
        eventA,
        eventB,
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
    expect(queue.enqueued).toHaveLength(2);
    await runtime.dispose();
  });

  it("uses runtime serializer for transport and avoids relay loops", async () => {
    const lane = r.eventLane("tests.event-lanes.serializer").build();
    const queue = new TestEventLaneQueue();
    const tagged = r
      .event<{ date: Date; pattern: RegExp; custom: CustomPayload }>(
        "tests.event-lanes.serializer.event",
      )
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();

    const serializerSetup = r
      .resource("tests.event-lanes.serializer.setup")
      .dependencies({ serializer: r.runner.serializer })
      .init(async (_config, { serializer }) => {
        serializer.addType?.({
          id: "tests.customPayload",
          is: (value): value is CustomPayload => value instanceof CustomPayload,
          serialize: (value) => ({ value: value.value }),
          deserialize: (value) =>
            new CustomPayload((value as { value: string }).value),
        });
      })
      .build();

    const payloads: Array<{
      date: Date;
      pattern: RegExp;
      custom: CustomPayload;
    }> = [];
    const hook = r
      .hook("tests.event-lanes.serializer.hook")
      .on(tagged)
      .run(async (event) => {
        payloads.push(event.data);
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.serializer.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({
          date: new Date("2024-01-01T00:00:00.000Z"),
          pattern: /hello/gi,
          custom: new CustomPayload("v1"),
        });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.serializer.app")
      .register([
        serializerSetup,
        tagged,
        hook,
        emitTask,
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
    await runtime.runTask(emitTask);

    await waitUntil(() => payloads.length === 1);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].date).toBeInstanceOf(Date);
    expect(payloads[0].pattern).toBeInstanceOf(RegExp);
    expect(payloads[0].custom).toBeInstanceOf(CustomPayload);

    await runtime.dispose();
  });

  it("fails fast when tagged lane has no binding", async () => {
    const lane = r.eventLane("tests.event-lanes.missing-binding").build();
    const tagged = r
      .event("tests.event-lanes.missing-binding.event")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();
    const emitTask = r
      .task("tests.event-lanes.missing-binding.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => tagged())
      .build();

    const app = r
      .resource("tests.event-lanes.missing-binding.app")
      .register([
        tagged,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `Event lane "${lane.id}" has no queue binding`,
    );
  });

  it("fails fast when maxAttempts is invalid", async () => {
    const lane = r.eventLane("tests.event-lanes.invalid-max-attempts").build();
    const queue = new TestEventLaneQueue();

    const app = r
      .resource("tests.event-lanes.invalid-max-attempts.app")
      .register([
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane, queue, maxAttempts: 0 }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow('field "maxAttempts"');
  });

  it("fails fast when retryDelayMs is invalid", async () => {
    const lane = r.eventLane("tests.event-lanes.invalid-retry-delay").build();
    const queue = new TestEventLaneQueue();

    const app = r
      .resource("tests.event-lanes.invalid-retry-delay.app")
      .register([
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane, queue, retryDelayMs: -1 }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow('field "retryDelayMs"');
  });

  it("supports centralized topology config with many lanes mapped to one queue", async () => {
    const laneA = r.eventLane("tests.event-lanes.topology.laneA").build();
    const laneB = r.eventLane("tests.event-lanes.topology.laneB").build();
    const sharedQueue = new TestEventLaneQueue();

    const eventA = r
      .event<{ id: string }>("tests.event-lanes.topology.eventA")
      .tags([r.runner.tags.eventLane.with({ lane: laneA })])
      .build();
    const eventB = r
      .event<{ id: string }>("tests.event-lanes.topology.eventB")
      .tags([r.runner.tags.eventLane.with({ lane: laneB })])
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests.event-lanes.topology.hookA")
      .on(eventA)
      .run(async (event) => {
        seen.push(`A:${event.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests.event-lanes.topology.hookB")
      .on(eventB)
      .run(async (event) => {
        seen.push(`B:${event.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.topology.emit")
      .dependencies({ eventA, eventB })
      .run(async (_input, deps) => {
        await deps.eventA({ id: "1" });
        await deps.eventB({ id: "2" });
      })
      .build();

    const topology = r.eventLane.topology({
      profiles: { worker: { consume: [laneA, laneB] } },
      bindings: [
        { lane: laneA, queue: sharedQueue },
        { lane: laneB, queue: sharedQueue },
      ],
    });

    const app = r
      .resource("tests.event-lanes.topology.app")
      .register([
        eventA,
        eventB,
        hookA,
        hookB,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology,
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => seen.length === 2);
    expect(seen).toEqual(expect.arrayContaining(["A:1", "B:2"]));
    expect(sharedQueue.consumeCalls).toBe(1);

    await runtime.dispose();
  });

  it("fails fast when the same lane is bound multiple times", async () => {
    const lane = r.eventLane("tests.event-lanes.duplicate-binding").build();
    const queueA = new TestEventLaneQueue();
    const queueB = new TestEventLaneQueue();

    const app = r
      .resource("tests.event-lanes.duplicate-binding.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [
              { lane, queue: queueA },
              { lane, queue: queueB },
            ],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `Event lane "${lane.id}" is bound multiple times. Define exactly one queue binding per lane.`,
    );
  });
});
