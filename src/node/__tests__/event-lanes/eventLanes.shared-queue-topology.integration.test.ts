import { defineResource } from "../../../define";
import { run } from "../../../run";
import { r } from "../../../public";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { eventLanesResource } from "../../event-lanes";

describe("eventLanes shared-queue topology", () => {
  it("fails fast when the active profile consumes only a subset of lanes bound to a shared queue", async () => {
    const sharedQueue = new MemoryEventLaneQueue();
    const laneA = r.eventLane("tests-event-lanes-shared-queue-lane-a").build();
    const laneB = r.eventLane("tests-event-lanes-shared-queue-lane-b").build();

    const app = defineResource({
      id: "tests-event-lanes-shared-queue-invalid-app",
      register: [
        eventLanesResource.with({
          profile: "worker",
          mode: "network",
          topology: {
            profiles: {
              worker: { consume: [{ lane: laneA }] },
            },
            bindings: [
              { lane: laneA, queue: sharedQueue },
              { lane: laneB, queue: sharedQueue },
            ],
          },
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "eventLanes-sharedQueuePartialConsume",
    });
  });

  it("fails fast during dryRun for partial shared-queue consumption", async () => {
    const sharedQueue = new MemoryEventLaneQueue();
    const laneA = r
      .eventLane("tests-event-lanes-shared-queue-dry-run-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-lanes-shared-queue-dry-run-lane-b")
      .build();

    const app = defineResource({
      id: "tests-event-lanes-shared-queue-dry-run-app",
      register: [
        eventLanesResource.with({
          profile: "worker",
          mode: "network",
          topology: {
            profiles: {
              worker: { consume: [{ lane: laneA }] },
            },
            bindings: [
              { lane: laneA, queue: sharedQueue },
              { lane: laneB, queue: sharedQueue },
            ],
          },
        }),
      ],
    });

    await expect(run(app, { dryRun: true })).rejects.toMatchObject({
      name: "eventLanes-sharedQueuePartialConsume",
    });
  });

  it("allows startup when the active profile consumes every lane bound to the shared queue", async () => {
    const sharedQueue = new MemoryEventLaneQueue();
    const laneA = r
      .eventLane("tests-event-lanes-shared-queue-valid-lane-a")
      .build();
    const laneB = r
      .eventLane("tests-event-lanes-shared-queue-valid-lane-b")
      .build();

    const app = defineResource({
      id: "tests-event-lanes-shared-queue-valid-app",
      register: [
        eventLanesResource.with({
          profile: "worker",
          mode: "network",
          topology: {
            profiles: {
              worker: { consume: [{ lane: laneA }, { lane: laneB }] },
            },
            bindings: [
              { lane: laneA, queue: sharedQueue },
              { lane: laneB, queue: sharedQueue },
            ],
          },
        }),
      ],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });
});
