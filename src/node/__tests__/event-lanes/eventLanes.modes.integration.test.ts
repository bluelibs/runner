import { createMessageError } from "../../../errors";
import { r, run, tags } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type {
  EventLaneMessage,
  IEventLaneQueue,
} from "../../event-lanes/types";

class TrackingQueue implements IEventLaneQueue {
  public enqueued: EventLaneMessage[] = [];
  public consumeCalls = 0;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const full: EventLaneMessage = {
      ...message,
      id: `m-${this.enqueued.length + 1}`,
      createdAt: new Date(),
      attempts: 0,
    };
    this.enqueued.push(full);
    return full.id;
  }

  async consume(): Promise<void> {
    this.consumeCalls += 1;
  }

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

describe("event-lanes: mode-first routing", () => {
  it("transparent mode bypasses lane transport and keeps tagged emits local", async () => {
    const lane = r.eventLane("tests.event-lanes.mode.transparent.lane").build();
    const queue = new TrackingQueue();
    let hookRuns = 0;

    const tagged = r
      .event<{ value: number }>("tests.event-lanes.mode.transparent.event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    const hook = r
      .hook("tests.event-lanes.mode.transparent.hook")
      .on(tagged)
      .run(async () => {
        hookRuns += 1;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.mode.transparent.emit")
      .dependencies({ tagged })
      .run(async (_input, deps) => {
        await deps.tagged({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.mode.transparent.app")
      .register([
        tagged,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    expect(hookRuns).toBe(1);
    expect(queue.enqueued).toHaveLength(0);
    expect(queue.consumeCalls).toBe(0);

    await runtime.dispose();
  });

  it("local-simulated mode ignores consume profile and relays tagged events asynchronously", async () => {
    const lane = r.eventLane("tests.event-lanes.mode.simulated.lane").build();
    let hookRuns = 0;

    const tagged = r
      .event<{ value: number }>("tests.event-lanes.mode.simulated.event")
      .tags([tags.eventLane.with({ lane })])
      .build();

    const hook = r
      .hook("tests.event-lanes.mode.simulated.hook")
      .on(tagged)
      .run(async (emission) => {
        hookRuns += 1;
        emission.data.value = 2;
      })
      .build();

    const emitTask = r
      .task("tests.event-lanes.mode.simulated.emit")
      .dependencies({ tagged })
      .run(async (input: { value: number }, deps) => {
        await deps.tagged(input);
        return hookRuns;
      })
      .build();

    const app = r
      .resource("tests.event-lanes.mode.simulated.app")
      .register([
        tagged,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "local-simulated",
          topology: {
            profiles: { worker: { consume: [] } },
            bindings: [],
          },
        }),
      ])
      .build();

    const runtime = await run(app);

    const payload = { value: 1 };
    await expect(runtime.runTask(emitTask, payload)).resolves.toBe(0);
    expect(payload.value).toBe(1);
    await waitUntil(() => hookRuns === 1);

    await runtime.dispose();
  });
});
