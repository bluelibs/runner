import { defineResource, r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

const fakeRpcLanesState = defineResource({
  id: RPC_LANES_RESOURCE_ID,
  configSchema: {
    parse: (value: unknown) => value,
  },
  init: async () => null,
});

describe("eventLanes applyTo cross-source topology checks", () => {
  it("detects rpc lane assignment from string applyTo ids in topology state", async () => {
    const event = r
      .event("tests-event-lanes-apply-to-rpc-string-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-apply-to-rpc-string-event-lane")
      .applyTo([event])
      .build();
    const app = r
      .resource("tests-event-lanes-apply-to-rpc-string-app")
      .register([
        event,
        fakeRpcLanesState.with({
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [
              {
                lane: r
                  .rpcLane("tests-event-lanes-apply-to-rpc-string-rpc")
                  .applyTo([event.id])
                  .build(),
              },
            ],
          },
        }),
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(
      `Event "${event.id}" cannot be assigned to eventLane "${lane.id}" because it is already assigned to an rpcLane.`,
    );
  });

  it("ignores non-event rpc applyTo entries while collecting cross-lane assignments", async () => {
    const event = r
      .event("tests-event-lanes-apply-to-rpc-invalid-event")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-apply-to-rpc-invalid-event-lane")
      .applyTo([event])
      .build();
    const app = r
      .resource("tests-event-lanes-apply-to-rpc-invalid-app")
      .register([
        event,
        fakeRpcLanesState.with({
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [
              {
                lane: r
                  .rpcLane("tests-event-lanes-apply-to-rpc-invalid-empty")
                  .build(),
              },
              {
                lane: r
                  .rpcLane("tests-event-lanes-apply-to-rpc-invalid-shape")
                  .applyTo([{} as any])
                  .build(),
              },
            ],
          },
        }),
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.dispose();
  });
});
