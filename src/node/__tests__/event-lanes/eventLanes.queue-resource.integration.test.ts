import { createMessageError } from "../../../errors";
import { r, run, tags } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class ResourceBackedQueue implements IEventLaneQueue {
  private seq = 0;
  private handler: ((message: EventLaneMessage) => Promise<void>) | null = null;
  private pending: EventLaneMessage[] = [];

  public consumeCalls = 0;
  public initCalls = 0;
  public disposeCalls = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = `resource-${++this.seq}`;
    this.pending.push({
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    });
    setImmediate(() => void this.process());
    return id;
  }

  async consume(handler: (message: EventLaneMessage) => Promise<void>) {
    this.consumeCalls += 1;
    this.handler = handler;
    setImmediate(() => void this.process());
  }

  async ack(_messageId: string): Promise<void> {
    // no-op
  }

  async nack(_messageId: string, _requeue: boolean = true): Promise<void> {
    // no-op
  }

  async init(): Promise<void> {
    this.initCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  private async process(): Promise<void> {
    const handler = this.handler;
    if (!handler || this.pending.length === 0) {
      return;
    }

    while (this.pending.length > 0) {
      const next = this.pending.shift()!;
      await handler({
        ...next,
        attempts: next.attempts + 1,
      });
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

describe("event-lanes: queue resource bindings", () => {
  it("fails fast when direct queue binding is invalid", async () => {
    const lane = r.eventLane("tests.event-lanes.invalid-direct.lane").build();
    const app = r
      .resource("tests.event-lanes.invalid-direct.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: {} as unknown as IEventLaneQueue }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      'queue reference "binding.queue" did not resolve to a valid IEventLaneQueue',
    );
  });

  it("fails fast when direct queue binding is null", async () => {
    const lane = r
      .eventLane("tests.event-lanes.invalid-null-queue.lane")
      .build();
    const app = r
      .resource("tests.event-lanes.invalid-null-queue.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: null as unknown as IEventLaneQueue }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      'queue reference "binding.queue" did not resolve to a valid IEventLaneQueue',
    );
  });

  it("fails fast when queue resource value is invalid", async () => {
    const lane = r
      .eventLane("tests.event-lanes.invalid-resource-queue.lane")
      .build();
    const invalidQueueResource = r
      .resource("tests.event-lanes.invalid-resource-queue.resource")
      .init(async () => ({}))
      .build();

    const app = r
      .resource("tests.event-lanes.invalid-resource-queue.app")
      .register([
        invalidQueueResource,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: invalidQueueResource }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `queue reference "__eventLaneQueue__:${invalidQueueResource.id}" did not resolve to a valid IEventLaneQueue`,
    );
  });

  it("resolves queue resource references from container dependencies", async () => {
    const lane = r.eventLane("tests.event-lanes.queue-resource.lane").build();
    const event = r
      .event<{ id: string }>("tests.event-lanes.queue-resource.event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    let hookCalls = 0;
    const hook = r
      .hook("tests.event-lanes.queue-resource.hook")
      .on(event)
      .run(async () => {
        hookCalls += 1;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.queue-resource.emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "1" });
      })
      .build();

    const queueResource = r
      .resource("tests.event-lanes.queue-resource.queue")
      .init(async () => new ResourceBackedQueue())
      .dispose(async (queue) => {
        await queue.dispose();
      })
      .build();

    const app = r
      .resource("tests.event-lanes.queue-resource.app")
      .register([
        event,
        hook,
        emitTask,
        queueResource,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: queueResource }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    const queue = await runtime.getResourceValue(queueResource);

    await runtime.runTask(emitTask);
    await waitUntil(() => hookCalls === 1);
    expect(queue.consumeCalls).toBe(1);
    expect(queue.initCalls).toBe(0);

    await runtime.dispose();
    expect(queue.disposeCalls).toBe(1);
  });
});
