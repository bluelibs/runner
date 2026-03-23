import { r, run } from "../../..";
import { genericError } from "../../../errors";
import {
  hashRemoteLanePayload,
  issueRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";
import { runtimeSource } from "../../../types/runtimeSource";

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
    if (requeue && message) {
      this.enqueued.push(message);
    }
    if (requeue) {
      this.nackedRequeue += 1;
    } else {
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
    if (!this.handler || this.enqueued.length === 0) {
      return;
    }

    while (this.enqueued.length > 0) {
      const queued = this.enqueued.shift()!;
      const message = {
        ...queued,
        attempts: queued.attempts + 1,
      };
      this.inFlight.set(message.id, message);
      await this.handler(message);
    }
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw genericError.new({ message: "waitUntil timed out" });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createSignedMessage(options: {
  laneId: string;
  eventId: string;
  payload: string;
  auth?: { secret: string };
}): Omit<EventLaneMessage, "id" | "createdAt" | "attempts"> {
  const { laneId, eventId, payload, auth } = options;
  return {
    laneId,
    eventId,
    payload,
    source: runtimeSource.task("tests-event-lanes-poison.source"),
    authToken: auth
      ? issueRemoteLaneToken({
          laneId,
          bindingAuth: auth,
          capability: "produce",
          target: {
            kind: "event-lane",
            targetId: eventId,
            payloadHash: hashRemoteLanePayload(payload),
          },
        })
      : undefined,
  };
}

describe("event-lanes poison message handling", () => {
  it("rejects wrong-event-on-valid-lane messages with nack(false)", async () => {
    const queue = new TestQueue();
    const auth = { secret: "poison-secret" };
    const assignedEvent = r
      .event<{ value: number }>("tests-event-lanes-poison-assigned-event")
      .build();
    const foreignEvent = r
      .event<{ value: number }>("tests-event-lanes-poison-foreign-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-poison-lane")
      .applyTo([assignedEvent])
      .build();
    let hookRuns = 0;
    const hook = r
      .hook("tests-event-lanes-poison-hook")
      .on(foreignEvent)
      .run(async () => {
        hookRuns += 1;
      })
      .build();
    const app = r
      .resource("tests-event-lanes-poison-app")
      .register([
        assignedEvent,
        foreignEvent,
        hook,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
            bindings: [{ lane, queue, auth }],
          },
          mode: "network",
        }),
      ])
      .build();

    const runtime = await run(app);
    await queue.enqueue(
      createSignedMessage({
        laneId: lane.id,
        eventId: foreignEvent.id,
        payload: JSON.stringify({ value: 1 }),
        auth,
      }),
    );

    await waitUntil(() => queue.nackedNoRequeue === 1);
    expect(queue.nackedRequeue).toBe(0);
    expect(hookRuns).toBe(0);

    await runtime.dispose();
  });

  it("rejects invalid lane JWT messages with nack(false)", async () => {
    const queue = new TestQueue();
    const auth = { secret: "poison-secret" };
    const event = r
      .event<{ value: number }>("tests-event-lanes-poison-auth-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-poison-auth-lane")
      .applyTo([event])
      .build();
    let hookRuns = 0;
    const hook = r
      .hook("tests-event-lanes-poison-auth-hook")
      .on(event)
      .run(async () => {
        hookRuns += 1;
      })
      .build();
    const app = r
      .resource("tests-event-lanes-poison-auth-app")
      .register([
        event,
        hook,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
            bindings: [{ lane, queue, auth }],
          },
          mode: "network",
        }),
      ])
      .build();

    const runtime = await run(app);
    await queue.enqueue({
      laneId: lane.id,
      eventId: event.id,
      payload: JSON.stringify({ value: 1 }),
      source: runtimeSource.task("tests-event-lanes-poison-auth.source"),
      authToken: "Bearer no",
    });

    await waitUntil(() => queue.nackedNoRequeue === 1);
    expect(queue.nackedRequeue).toBe(0);
    expect(hookRuns).toBe(0);

    await runtime.dispose();
  });

  it("rejects malformed payload messages with nack(false)", async () => {
    const queue = new TestQueue();
    const auth = { secret: "poison-secret" };
    const event = r
      .event<{ value: number }>("tests-event-lanes-poison-payload-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-poison-payload-lane")
      .applyTo([event])
      .build();
    let hookRuns = 0;
    const hook = r
      .hook("tests-event-lanes-poison-payload-hook")
      .on(event)
      .run(async () => {
        hookRuns += 1;
      })
      .build();
    const app = r
      .resource("tests-event-lanes-poison-payload-app")
      .register([
        event,
        hook,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
            bindings: [{ lane, queue, auth }],
          },
          mode: "network",
        }),
      ])
      .build();

    const runtime = await run(app);
    await queue.enqueue(
      createSignedMessage({
        laneId: lane.id,
        eventId: event.id,
        payload: "{invalid-json",
        auth,
      }),
    );

    await waitUntil(() => queue.nackedNoRequeue === 1);
    expect(queue.nackedRequeue).toBe(0);
    expect(hookRuns).toBe(0);

    await runtime.dispose();
  });
});
