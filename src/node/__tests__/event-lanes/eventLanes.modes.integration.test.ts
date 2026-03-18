import { genericError } from "../../../errors";
import { r, run } from "../../..";
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
      throw genericError.new({ message: "waitUntil timed out" });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("event-lanes: mode-first routing", () => {
  it("transparent mode bypasses lane transport and keeps tagged emits local", async () => {
    const queue = new TrackingQueue();
    let hookRuns = 0;

    const event = r
      .event<{ value: number }>("tests-event-lanes-mode-transparent-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-mode-transparent-lane")
      .applyTo([event])
      .build();

    const hook = r
      .hook("tests-event-lanes-mode-transparent-hook")
      .on(event)
      .run(async () => {
        hookRuns += 1;
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-mode-transparent-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-mode-transparent-app")
      .register([
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
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
    let hookRuns = 0;

    const event = r
      .event<{ value: number }>("tests-event-lanes-mode-simulated-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-mode-simulated-lane")
      .applyTo([event])
      .build();

    const hook = r
      .hook("tests-event-lanes-mode-simulated-hook")
      .on(event)
      .run(async (emission) => {
        hookRuns += 1;
        emission.data.value = 2;
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-mode-simulated-emit")
      .dependencies({ event })
      .run(async (input: { value: number }, deps) => {
        await deps.event(input);
        return hookRuns;
      })
      .build();

    const app = r
      .resource("tests-event-lanes-mode-simulated-app")
      .register([
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "local-simulated",
          topology: {
            profiles: { worker: { consume: [{ lane }] } },
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
