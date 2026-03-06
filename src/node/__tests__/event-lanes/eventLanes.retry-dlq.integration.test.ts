import { createMessageError } from "../../../errors";
import { r, run, tags } from "../../..";
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
  public nackedRequeue = 0;

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
    } else {
      this.nackedRequeue += 1;
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

describe("event-lanes: failure settlement + retries", () => {
  it("nacks without requeue after final failure", async () => {
    const lane = r.eventLane("tests-event-lanes-failure-settle-lane").build();
    const queue = new TestQueue();

    const tagged = r
      .event<{ id: string }>("tests-event-lanes-failure-settle-event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    const failingHook = r
      .hook("tests-event-lanes-failure-settle-failing-hook")
      .on(tagged)
      .run(async () => {
        throw createMessageError("hook failed");
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-failure-settle-emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-1" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-failure-settle-app")
      .register([
        tagged,
        failingHook,
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

    await waitUntil(() => queue.nackedNoRequeue === 1);
    expect(queue.nackedRequeue).toBe(0);

    await runtime.dispose();
  });

  it("normalizes primitive failures and still settles with nack(false)", async () => {
    const lane = r
      .eventLane("tests-event-lanes-failure-primitive-lane")
      .build();
    const queue = new TestQueue();

    const tagged = r
      .event<{ id: string }>("tests-event-lanes-failure-primitive-event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    const failingHook = r
      .hook("tests-event-lanes-failure-primitive-failing-hook")
      .on(tagged)
      .run(async () => {
        throw "primitive-failure";
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-failure-primitive-emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-primitive" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-failure-primitive-app")
      .register([
        tagged,
        failingHook,
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

    await waitUntil(() => queue.nackedNoRequeue === 1);
    expect(queue.nackedRequeue).toBe(0);

    await runtime.dispose();
  });

  it("retries before final nack(false) when maxAttempts is greater than one", async () => {
    const lane = r.eventLane("tests-event-lanes-retry-multiple-lane").build();
    const queue = new TestQueue();

    const tagged = r
      .event<{ id: string }>("tests-event-lanes-retry-multiple-event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    const failingHook = r
      .hook("tests-event-lanes-retry-multiple-failing-hook")
      .on(tagged)
      .run(async () => {
        throw createMessageError("hook failed on retry");
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-retry-multiple-emit")
      .dependencies({ tagged })
      .run(async (_input, { tagged }) => {
        await tagged({ id: "evt-retry" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-retry-multiple-app")
      .register([
        tagged,
        failingHook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue, maxAttempts: 2 }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(
      () => queue.nackedRequeue === 1 && queue.nackedNoRequeue === 1,
    );

    await runtime.dispose();
  });
});
