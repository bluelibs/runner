import { createMessageError } from "../../../errors";
import { globals, r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class TestQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;
  private inFlight = new Map<string, EventLaneMessage>();

  public enqueued: EventLaneMessage[] = [];
  public nackedNoRequeue = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `m-${++this.seq}`;
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
    const message = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (requeue && message && message.attempts < message.maxAttempts) {
      this.enqueued.push(message);
    }
    if (!requeue) {
      this.nackedNoRequeue += 1;
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

describe("event-lanes: failure + dlq", () => {
  it("nacks and sends failures to DLQ", async () => {
    const lane = r.eventLane("tests.event-lanes.retry.lane").build();
    const queue = new TestQueue();
    const dlq = new TestQueue();

    const tagged = r
      .event<{ id: string }>("tests.event-lanes.retry.event")
      .tags([globals.tags.eventLane.with({ lane })])
      .build();

    const failingHook = r
      .hook("tests.event-lanes.retry.failing-hook")
      .on(tagged)
      .run(async () => {
        throw createMessageError("hook failed");
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.retry.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-1" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.retry.app")
      .register([
        tagged,
        failingHook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue, dlq: { queue: dlq } }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => dlq.enqueued.length === 1);
    expect(dlq.enqueued[0].eventId).toBe(tagged.id);
    expect(
      (dlq.enqueued[0].metadata as { eventLaneDlq?: { reason?: string } })
        .eventLaneDlq?.reason,
    ).toContain("hook failed");
    expect(queue.nackedNoRequeue).toBe(1);

    await runtime.dispose();
  });

  it("normalizes non-Error failures before DLQ and logger reporting", async () => {
    const lane = r.eventLane("tests.event-lanes.retry.primitive.lane").build();
    const queue = new TestQueue();
    const dlq = new TestQueue();

    const tagged = r
      .event<{ id: string }>("tests.event-lanes.retry.primitive.event")
      .tags([globals.tags.eventLane.with({ lane })])
      .build();

    const failingHook = r
      .hook("tests.event-lanes.retry.primitive.failing-hook")
      .on(tagged)
      .run(async () => {
        throw "primitive-failure";
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.retry.primitive.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-primitive" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.retry.primitive.app")
      .register([
        tagged,
        failingHook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue, dlq: { queue: dlq } }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => dlq.enqueued.length === 1);
    expect(
      (dlq.enqueued[0].metadata as { eventLaneDlq?: { reason?: string } })
        .eventLaneDlq?.reason,
    ).toContain("primitive-failure");

    await runtime.dispose();
  });

  it("normalizes primitive serializer failures in consumer catch path", async () => {
    const lane = r
      .eventLane("tests.event-lanes.retry.serializer-primitive.lane")
      .build();
    const queue = new TestQueue();
    const dlq = new TestQueue();

    const tagged = r
      .event<{ id: string }>(
        "tests.event-lanes.retry.serializer-primitive.event",
      )
      .tags([globals.tags.eventLane.with({ lane })])
      .build();

    const serializerBreaker = r
      .resource("tests.event-lanes.retry.serializer-primitive.breaker")
      .dependencies({ serializer: globals.resources.serializer })
      .init(async (_config, { serializer }) => {
        const originalParse = serializer.parse.bind(serializer);
        serializer.parse = <T = unknown>(_payload: string): T => {
          throw "primitive-parse-error";
        };
        return { originalParse };
      })
      .dispose(async (value, _config, { serializer }) => {
        serializer.parse = value.originalParse;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.retry.serializer-primitive.emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-serializer-primitive" });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.retry.serializer-primitive.app")
      .register([
        serializerBreaker,
        tagged,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue, dlq: { queue: dlq } }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => dlq.enqueued.length === 1);
    expect(
      (dlq.enqueued[0].metadata as { eventLaneDlq?: { reason?: string } })
        .eventLaneDlq?.reason,
    ).toContain("primitive-parse-error");

    await runtime.dispose();
  });
});
