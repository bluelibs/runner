import { genericError } from "../../../errors";
import { runtimeSource } from "../../../types/runtimeSource";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import { globalTags } from "../../../globals/globalTags";
import { r, resources, run } from "../../..";

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

describe("event-lanes hook isolation", () => {
  it("runs only topology-allowed hooks for relay emissions on a consumed lane", async () => {
    const queue = new MemoryEventLaneQueue();
    const event = r
      .event<{ id: string }>("tests-event-lanes-hook-filter-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-lane")
      .applyTo([event])
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests-event-lanes-hook-filter-hook-a")
      .on(event)
      .run(async (emission) => {
        seen.push(`A:${emission.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests-event-lanes-hook-filter-hook-b")
      .on(event)
      .run(async (emission) => {
        seen.push(`B:${emission.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-hook-filter-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "1" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-app")
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

  it("does not apply topology hooks.only filtering to transparent local emissions", async () => {
    const queue = new MemoryEventLaneQueue();
    const event = r
      .event<{ id: string }>("tests-event-lanes-hook-filter-transparent-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-transparent-lane")
      .applyTo([event])
      .build();

    const seen: string[] = [];
    const hookA = r
      .hook("tests-event-lanes-hook-filter-transparent-hook-a")
      .on(event)
      .run(async (emission) => {
        seen.push(`A:${emission.data.id}`);
      })
      .build();
    const hookB = r
      .hook("tests-event-lanes-hook-filter-transparent-hook-b")
      .on(event)
      .run(async (emission) => {
        seen.push(`B:${emission.data.id}`);
      })
      .build();

    const emitTask = r
      .task("tests-event-lanes-hook-filter-transparent-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event({ id: "local" });
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-transparent-app")
      .register([
        event,
        hookA,
        hookB,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
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

    expect(seen).toEqual(["A:local", "B:local"]);
    await runtime.dispose();
  });

  it("skips hooks when relay source lane id is malformed and topology hooks.only exists", async () => {
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-malformed-lane")
      .build();
    const event = r
      .event<{ id: string }>("tests-event-lanes-hook-filter-malformed-event")
      .build();

    const seen: string[] = [];
    const hook = r
      .hook("tests-event-lanes-hook-filter-malformed-hook")
      .on(event)
      .run(async (emission) => {
        seen.push(emission.data.id);
      })
      .build();

    const emitRelayTask = r
      .task("tests-event-lanes-hook-filter-malformed-emit")
      .dependencies({ eventManager: resources.eventManager })
      .run(async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { id: "x" },
          runtimeSource.runtime("runner.event-lanes.relay:worker:"),
        );
      })
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-malformed-app")
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

  it("fails fast when deprecated eventLaneHook tags conflict with topology hook policy", async () => {
    const event = r
      .event("tests-event-lanes-hook-filter-deprecated-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-deprecated-lane")
      .applyTo([event])
      .build();
    const hook = r
      .hook("tests-event-lanes-hook-filter-deprecated-hook")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-deprecated-app")
      .register([
        event,
        hook,
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

    await expect(run(app)).rejects.toThrow(
      /cannot combine deprecated tag "eventLaneHook" with topology hooks\.only policy/i,
    );
  });

  it("fails fast when a hook uses deprecated eventLaneHook without topology hooks.only", async () => {
    const event = r
      .event("tests-event-lanes-hook-filter-deprecated-no-policy-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-deprecated-no-policy-lane")
      .applyTo([event])
      .build();
    const hook = r
      .hook("tests-event-lanes-hook-filter-deprecated-no-policy-hook")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-deprecated-no-policy-app")
      .register([
        event,
        hook,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane }],
              },
            },
            bindings: [{ lane, queue: new MemoryEventLaneQueue() }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      /uses deprecated tag "eventLaneHook"/i,
    );
  });

  it("fails fast when hooks.only references an unregistered hook", async () => {
    const event = r
      .event("tests-event-lanes-hook-filter-unregistered-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-unregistered-lane")
      .applyTo([event])
      .build();
    const strayHook = r
      .hook("tests-event-lanes-hook-filter-unregistered-hook")
      .on(event)
      .run(async () => {})
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-unregistered-app")
      .register([
        event,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane, hooks: { only: [strayHook] } }],
              },
            },
            bindings: [{ lane, queue: new MemoryEventLaneQueue() }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(/hooks\.only.*not registered/i);
  });

  it("fails fast when the same lane appears twice in one consume profile", async () => {
    const event = r
      .event("tests-event-lanes-hook-filter-duplicate-lane-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-hook-filter-duplicate-lane")
      .applyTo([event])
      .build();

    const app = r
      .resource("tests-event-lanes-hook-filter-duplicate-lane-app")
      .register([
        event,
        eventLanesResource.with({
          profile: "worker",
          topology: {
            profiles: {
              worker: {
                consume: [{ lane }, { lane }],
              },
            },
            bindings: [{ lane, queue: new MemoryEventLaneQueue() }],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      /declares lane .* more than once in profile "worker" consume/i,
    );
  });
});
