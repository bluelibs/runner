import { defineEvent, defineResource, r, run } from "../../..";
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
  it("does not treat non-canonical rpc applyTo string ids in topology state as matches", async () => {
    const event = defineEvent({
      id: "cross-event",
    });
    const lane = r.eventLane("cross-lane").applyTo([event]).build();
    const app = defineResource({
      id: "cross-app",
      register: [
        event,
        fakeRpcLanesState.with({
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [
              {
                lane: r.rpcLane("cross-rpc").applyTo([event.id]).build(),
              },
            ],
          },
        }),
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [{ lane: lane }] } },
            bindings: [],
          },
        }),
      ],
    });

    const runtime = await run(app);
    await runtime.dispose();
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
            profiles: { worker: { consume: [{ lane: lane }] } },
            bindings: [],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await runtime.dispose();
  });
});
