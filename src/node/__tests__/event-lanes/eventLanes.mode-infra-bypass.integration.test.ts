import { createMessageError } from "../../../errors";
import { r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";

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

describe("eventLanesResource mode infrastructure bypass", () => {
  it("transparent mode does not require queue dependency resolution", async () => {
    const lane = r
      .eventLane("tests.event-lanes.transparent.no-deps.lane")
      .build();
    const unregisteredQueueResource = r
      .resource("tests.event-lanes.transparent.no-deps.queue")
      .init(async () => new MemoryEventLaneQueue())
      .build();

    let hookRuns = 0;
    const event = r
      .event<{ value: number }>("tests.event-lanes.transparent.no-deps.event")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();
    const hook = r
      .hook("tests.event-lanes.transparent.no-deps.hook")
      .on(event)
      .run(async () => {
        hookRuns += 1;
      })
      .build();
    const emitTask = r
      .task("tests.event-lanes.transparent.no-deps.emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.transparent.no-deps.app")
      .register([
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: unregisteredQueueResource }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    expect(hookRuns).toBe(1);
    await runtime.dispose();
  });

  it("local-simulated mode does not require queue dependency resolution", async () => {
    const lane = r
      .eventLane("tests.event-lanes.simulated.no-deps.lane")
      .build();
    const unregisteredQueueResource = r
      .resource("tests.event-lanes.simulated.no-deps.queue")
      .init(async () => new MemoryEventLaneQueue())
      .build();

    let hookRuns = 0;
    const event = r
      .event<{ value: number }>("tests.event-lanes.simulated.no-deps.event")
      .tags([r.runner.tags.eventLane.with({ lane })])
      .build();
    const hook = r
      .hook("tests.event-lanes.simulated.no-deps.hook")
      .on(event)
      .run(async () => {
        hookRuns += 1;
      })
      .build();
    const emitTask = r
      .task("tests.event-lanes.simulated.no-deps.emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ value: 1 });
      })
      .build();

    const app = r
      .resource("tests.event-lanes.simulated.no-deps.app")
      .register([
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "local-simulated",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue: unregisteredQueueResource }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);
    await waitUntil(() => hookRuns === 1);
    await runtime.dispose();
  });
});
