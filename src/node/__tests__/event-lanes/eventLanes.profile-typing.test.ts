import { r } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import type { IEventLaneQueue } from "../../event-lanes/types";

function createQueueStub(): IEventLaneQueue {
  return {
    async enqueue() {
      return "stub-id";
    },
    async consume() {
      // no-op
    },
    async ack() {
      // no-op
    },
    async nack() {
      // no-op
    },
  };
}

describe("event-lanes: resource profile typing", () => {
  it("accepts profile keys inferred from topology", () => {
    const lane = r
      .eventLane("tests.event-lanes.profile-typing.accepted.lane")
      .build();
    const queue = createQueueStub();

    const topology = r.eventLane.topology({
      profiles: {
        api: { consume: [] },
        worker: { consume: [lane] },
      },
      bindings: [{ lane, queue }],
    });

    const Profiles = {
      API: "api",
      WORKER: "worker",
    } as const;

    const apiConfig = eventLanesResource.with({
      profile: Profiles.API,
      topology,
    });
    const workerConfig = eventLanesResource.with({
      profile: Profiles.WORKER,
      topology,
    });

    expect(apiConfig.id).toBe(eventLanesResource.id);
    expect(workerConfig.id).toBe(eventLanesResource.id);
  });

  it("rejects unknown profiles at compile time", () => {
    const lane = r
      .eventLane("tests.event-lanes.profile-typing.rejected.lane")
      .build();
    const queue = createQueueStub();
    const topology = r.eventLane.topology({
      profiles: {
        api: { consume: [lane] },
      },
      bindings: [{ lane, queue }],
    });

    eventLanesResource.with({
      // @ts-expect-error Profile "worker" is not part of topology.profiles keys.
      profile: "worker",
      topology,
    });

    expect(true).toBe(true);
  });
});
