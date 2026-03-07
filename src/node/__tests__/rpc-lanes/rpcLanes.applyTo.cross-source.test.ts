import { defineEvent, defineResource } from "../../../define";
import { run } from "../../../run";
import { r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";
import { EVENT_LANES_RESOURCE_ID } from "../../event-lanes/eventLanes.resource";

describe("rpcLanes applyTo cross-source topology checks", () => {
  it("detects event lane assignment from string applyTo ids in topology state", async () => {
    const event = defineEvent({
      id: "tests-rpc-lanes-apply-to-event-lane-string-event",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-event-lane-string-rpc")
      .applyTo([event])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-event-lane-string-communicator",
      init: async () => ({
        event: async () => undefined,
      }),
    });
    const fakeEventLanesState = r
      .resource<any>(EVENT_LANES_RESOURCE_ID, {
        frameworkOwned: true,
      })
      .init(async () => null)
      .build();

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-event-lane-string-app",
      register: [
        event,
        communicator,
        fakeEventLanesState.with({
          topology: {
            profiles: { worker: { consume: [] } },
            bindings: [
              {
                lane: r
                  .eventLane(
                    "tests-rpc-lanes-apply-to-event-lane-string-event-lane",
                  )
                  .applyTo([event.id])
                  .build(),
              },
            ],
          },
        }),
        rpcLanesResource.with({
          profile: "client",
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [{ lane, communicator }],
          },
        }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      `Event "${event.id}" cannot be assigned to rpcLane "${lane.id}" because it is already assigned to an event lane.`,
    );
  });

  it("ignores non-event event-lane applyTo entries while collecting cross-lane assignments", async () => {
    const task = defineResource({
      id: "tests-rpc-lanes-apply-to-event-lane-invalid-task-resource",
      init: async () => "ok",
    });
    const callableTask = r
      .task("tests-rpc-lanes-apply-to-event-lane-invalid-task")
      .run(async () => "local")
      .build();
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-event-lane-invalid-rpc")
      .applyTo([callableTask])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-event-lane-invalid-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const fakeEventLanesState = r
      .resource<any>(EVENT_LANES_RESOURCE_ID, {
        frameworkOwned: true,
      })
      .init(async () => null)
      .build();

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-event-lane-invalid-app",
      register: [
        task,
        callableTask,
        communicator,
        fakeEventLanesState.with({
          topology: {
            profiles: { worker: { consume: [] } },
            bindings: [
              {
                lane: r
                  .eventLane(
                    "tests-rpc-lanes-apply-to-event-lane-invalid-empty",
                  )
                  .build(),
              },
              {
                lane: r
                  .eventLane(
                    "tests-rpc-lanes-apply-to-event-lane-invalid-shape",
                  )
                  .applyTo([{} as any])
                  .build(),
              },
            ],
          },
        }),
        rpcLanesResource.with({
          profile: "client",
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [{ lane, communicator }],
          },
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(callableTask as any)).resolves.toBe("remote");
    await runtime.dispose();
  });
});
