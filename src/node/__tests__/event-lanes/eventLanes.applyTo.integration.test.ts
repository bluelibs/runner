import { createMessageError } from "../../../errors";
import { globals, r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";
import { rpcLanesResource } from "../../rpc-lanes";

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

describe("eventLanes applyTo", () => {
  it("routes applyTo event targets through lane producer transport without explicit tags", async () => {
    const queue = new RecordingQueue();
    const lane = r
      .eventLane("tests.event-lanes.apply-to.producer.lane")
      .applyTo(["tests.event-lanes.apply-to.producer.event"])
      .build();
    const event = r
      .event<{ value: number }>("tests.event-lanes.apply-to.producer.event")
      .build();

    let localHookRuns = 0;
    const hook = r
      .hook("tests.event-lanes.apply-to.producer.hook")
      .on(event)
      .run(async () => {
        localHookRuns += 1;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.apply-to.producer.emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.producer.app")
      .register([
        event,
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

    await waitUntil(() => queue.enqueued.length === 1);
    expect(queue.enqueued[0].eventId).toBe(event.id);
    expect(localHookRuns).toBe(0);

    await runtime.dispose();
  });

  it("allows same-lane event tag + applyTo without re-assignment conflicts", async () => {
    const queue = new RecordingQueue();
    const lane = r.eventLane("tests.event-lanes.apply-to.same-lane").build();
    const event = r
      .event<{ value: number }>("tests.event-lanes.apply-to.same-lane.event")
      .tags([globals.tags.eventLane.with({ lane })])
      .build();
    const configuredLane = r.eventLane(lane.id).applyTo([event]).build();
    const emitTask = r
      .task("tests.event-lanes.apply-to.same-lane.emit")
      .dependencies({ event })
      .run(async (_input, deps) => deps.event({ value: 2 }))
      .build();
    const app = r
      .resource("tests.event-lanes.apply-to.same-lane.app")
      .register([
        event,
        emitTask,
        eventLanesResource.with({
          profile: "producer",
          topology: {
            profiles: { producer: { consume: [] } },
            bindings: [{ lane: configuredLane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    await waitUntil(() => queue.enqueued.length === 1);
    await runtime.dispose();
  });

  it("fails fast when eventLane applyTo target resolves to task id", async () => {
    const task = r
      .task("tests.event-lanes.apply-to.invalid.task")
      .run(async () => "ok")
      .build();
    const lane = r
      .eventLane("tests.event-lanes.apply-to.invalid.lane")
      .applyTo([task.id])
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.invalid.app")
      .register([
        task,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `eventLane "${lane.id}" applyTo target "${task.id}" must reference an event, but resolved to a non-event definition.`,
    );
  });

  it("fails fast when eventLane applyTo string target does not exist", async () => {
    const lane = r
      .eventLane("tests.event-lanes.apply-to.missing-target.lane")
      .applyTo(["tests.event-lanes.apply-to.missing-target.event"])
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.missing-target.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `eventLane "${lane.id}" applyTo target "tests.event-lanes.apply-to.missing-target.event" was not found in this container.`,
    );
  });

  it("fails fast when eventLane applyTo receives an invalid target value", async () => {
    const lane = r
      .eventLane("tests.event-lanes.apply-to.invalid-shape.lane")
      .applyTo([{} as any])
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.invalid-shape.app")
      .register([
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `eventLane "${lane.id}" applyTo() received an invalid target.`,
    );
  });

  it("lets applyTo override tag-based event lane assignment (IoC)", async () => {
    const laneA = r.eventLane("tests.event-lanes.apply-to.override-ioc.a").build();
    const laneB = r
      .eventLane("tests.event-lanes.apply-to.override-ioc.b")
      .applyTo(["tests.event-lanes.apply-to.override-ioc.event"])
      .build();

    const event = r
      .event("tests.event-lanes.apply-to.override-ioc.event")
      .tags([globals.tags.eventLane.with({ lane: laneA })])
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.override-ioc.app")
      .register([
        event,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [laneA, laneB] } },
            bindings: [],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.dispose();
  });

  it("fails when eventLane applyTo collides with rpcLane applyTo on the same event", async () => {
    const event = r
      .event("tests.event-lanes.apply-to.cross-lane.event")
      .build();
    const lane = r
      .eventLane("tests.event-lanes.apply-to.cross-lane.event-lane")
      .applyTo([event])
      .build();
    const rpc = r
      .rpcLane("tests.event-lanes.apply-to.cross-lane.rpc-lane")
      .applyTo([event])
      .build();
    const communicator = r
      .resource("tests.event-lanes.apply-to.cross-lane.communicator")
      .init(async () => ({
        event: async () => undefined,
      }))
      .build();

    const app = r
      .resource("tests.event-lanes.apply-to.cross-lane.app")
      .register([
        event,
        communicator,
        rpcLanesResource.with({
          profile: "client",
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [{ lane: rpc, communicator }],
          },
        }),
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      /already assigned to an (rpcLane|event lane)/,
    );
  });
});
