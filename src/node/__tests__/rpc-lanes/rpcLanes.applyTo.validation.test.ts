import { defineEvent, defineResource } from "../../../define";
import { run } from "../../../run";
import { r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes applyTo validation", () => {
  it("fails fast when applyTo string target does not exist", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-missing-target-lane")
      .applyTo(["tests.rpc-lanes.apply-to.missing-target.task"])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-missing-target-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-missing-target-app",
      register: [
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      `rpcLane "${lane.id}" applyTo target "tests.rpc-lanes.apply-to.missing-target.task" was not found in this container.`,
    );
  });

  it("fails fast when applyTo receives an invalid target value", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-invalid-shape-lane")
      .applyTo([{} as any])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-invalid-shape-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-invalid-shape-app",
      register: [
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      `rpcLane "${lane.id}" applyTo() received an invalid target.`,
    );
  });

  it("fails when two rpc lanes applyTo the same event", async () => {
    const event = defineEvent({
      id: "tests-rpc-lanes-apply-to-reassign-event",
    });
    const laneA = r
      .rpcLane("tests-rpc-lanes-apply-to-reassign-event-a")
      .applyTo([event])
      .build();
    const laneB = r
      .rpcLane("tests-rpc-lanes-apply-to-reassign-event-b")
      .applyTo([event.id])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-reassign-event-communicator",
      init: async () => ({
        event: async () => undefined,
      }),
    });
    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-reassign-event-app",
      register: [
        event,
        communicator,
        rpcLanesResource.with({
          profile: "client",
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [
              { lane: laneA, communicator },
              { lane: laneB, communicator },
            ],
          },
        }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      `Event "${event.id}" is already assigned to rpcLane "${laneA.id}".`,
    );
  });
});
