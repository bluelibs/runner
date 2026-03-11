import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { runtimeSource } from "../../../types/runtimeSource";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { eventLanesResource } from "../../event-lanes";
import { r } from "../../../public";

describe("eventLanes auth in local-simulated mode", () => {
  it("relays events when lane auth material is configured", async () => {
    const lane = r
      .eventLane("tests-event-lanes-auth-local-simulated-lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests-event-lanes-auth-local-simulated-event",
      tags: [globalTags.eventLane.with({ lane })],
    });

    let seen = 0;
    const hook = r
      .hook("tests-event-lanes-auth-local-simulated-hook")
      .on(event)
      .run(async (emission) => {
        seen += emission.data.value;
      })
      .build();

    const emitTask = defineTask({
      id: "tests-event-lanes-auth-local-simulated-emit",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { value: 2 },
          runtimeSource.task("tests-event-lanes-auth-local-simulated-emit"),
        );
      },
    });

    const topology = {
      profiles: {
        test: { consume: [lane] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: { secret: "event-simulated-secret" },
        },
      ],
    } as const;

    const app = defineResource({
      id: "tests-event-lanes-auth-local-simulated-app",
      register: [
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "test",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    await runtime.runTask(emitTask as any);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toBe(2);
    await runtime.dispose();
  });

  it("fails fast when binding auth is enabled but signer secrets are missing", async () => {
    const lane = r
      .eventLane("tests-event-lanes-auth-local-simulated-missing-lane")
      .build();
    const event = defineEvent({
      id: "tests-event-lanes-auth-local-simulated-missing-event",
      tags: [globalTags.eventLane.with({ lane })],
    });

    const topology = {
      profiles: {
        test: { consume: [lane] },
      },
      bindings: [
        {
          lane,
          queue: new MemoryEventLaneQueue(),
          auth: {},
        },
      ],
    } as const;

    const app = defineResource({
      id: "tests-event-lanes-auth-local-simulated-missing-app",
      register: [
        event,
        eventLanesResource.with({
          profile: "test",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.remoteLanes.auth.signerMissing",
    });
  });
});
