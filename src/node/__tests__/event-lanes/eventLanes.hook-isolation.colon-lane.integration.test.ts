import { genericError } from "../../../errors";
import { runtimeSource } from "../../../types/runtimeSource";
import { r, resources, run } from "../../..";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";

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

describe("event-lanes hook isolation with colon lane ids", () => {
  it("applies hooks.only filtering for relay emissions on lanes whose ids contain colons", async () => {
    const queue = new MemoryEventLaneQueue();
    const event = r
      .event<{ id: string }>("tests-event-lanes-hook-filter-colon-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter:colon-lane")
      .applyTo([event])
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests-event-lanes-hook-filter-colon-hook-a")
      .on(event)
      .run(async (emission) => {
        seen.push(`A:${emission.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests-event-lanes-hook-filter-colon-hook-b")
      .on(event)
      .run(async (emission) => {
        seen.push(`B:${emission.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-hook-filter-colon-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "1" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-colon-app")
      .register([
        event,
        hookA,
        hookB,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane, hooks: { only: [hookA] } }],
              },
            },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => seen.includes("A:1"));
    expect(seen).toEqual(["A:1"]);

    await runtime.dispose();
  });

  it("applies hooks.only filtering to local-simulated relay emissions on colon lane ids", async () => {
    const event = r
      .event<{ id: string }>("tests-event-lanes-hook-filter-colon-local-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter:colon-local-lane")
      .applyTo([event])
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests-event-lanes-hook-filter-colon-local-hook-a")
      .on(event)
      .run(async (emission) => {
        seen.push(`A:${emission.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests-event-lanes-hook-filter-colon-local-hook-b")
      .on(event)
      .run(async (emission) => {
        seen.push(`B:${emission.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-hook-filter-colon-local-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "1" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-colon-local-app")
      .register([
        event,
        hookA,
        hookB,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "local-simulated",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane, hooks: { only: [hookA] } }],
              },
            },
            bindings: [],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitTask);

    await waitUntil(() => seen.includes("A:1"));
    expect(seen).toEqual(["A:1"]);

    await runtime.dispose();
  });

  it("skips hooks when a relay source uses an unknown non-suffixed lane id", async () => {
    const event = r
      .event<{
        id: string;
      }>("tests-event-lanes-hook-filter-colon-unknown-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter:colon-known-lane")
      .build();

    const seen: string[] = [];
    const hook = r
      .hook("tests-event-lanes-hook-filter-colon-unknown-hook")
      .on(event)
      .run(async (emission) => {
        seen.push(emission.data.id);
      })
      .build();

    const emitRelayTask = r
      .task("tests-event-lanes-hook-filter-colon-unknown-emit")
      .dependencies({ eventManager: resources.eventManager })
      .run(async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { id: "x" },
          runtimeSource.runtime("runner.event-lanes.relay:worker:unknown-lane"),
        );
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-colon-unknown-app")
      .register([
        event,
        hook,
        emitRelayTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane, hooks: { only: [hook] } }],
              },
            },
            bindings: [{ lane, queue: new MemoryEventLaneQueue() }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitRelayTask);

    expect(seen).toEqual([]);
    await runtime.dispose();
  });

  it("skips hooks when a local-simulated relay source uses an unknown lane id", async () => {
    const event = r
      .event<{
        id: string;
      }>("tests-event-lanes-hook-filter-colon-unknown-local-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter:colon-known-local-lane")
      .build();

    const seen: string[] = [];
    const hook = r
      .hook("tests-event-lanes-hook-filter-colon-unknown-local-hook")
      .on(event)
      .run(async (emission) => {
        seen.push(emission.data.id);
      })
      .build();

    const emitRelayTask = r
      .task("tests-event-lanes-hook-filter-colon-unknown-local-emit")
      .dependencies({ eventManager: resources.eventManager })
      .run(async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { id: "x" },
          runtimeSource.runtime(
            "runner.event-lanes.relay:worker:unknown-lane:local-simulated",
          ),
        );
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-colon-unknown-local-app")
      .register([
        event,
        hook,
        emitRelayTask,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane, hooks: { only: [hook] } }],
              },
            },
            bindings: [{ lane, queue: new MemoryEventLaneQueue() }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.runTask(emitRelayTask);

    expect(seen).toEqual([]);
    await runtime.dispose();
  });
});
