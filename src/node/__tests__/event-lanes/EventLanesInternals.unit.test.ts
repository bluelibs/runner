import { r } from "../../..";
import {
  buildEventLanesContext,
  isRelayEmission,
} from "../../event-lanes/EventLanesInternals";

describe("EventLanesInternals", () => {
  it("detects relay emissions from source ids when paths are absent", () => {
    expect(
      isRelayEmission(
        {
          id: "event.alpha",
          data: {},
          timestamp: new Date(),
          signal: new AbortController().signal,
          source: {
            kind: "runtime",
            id: "relay:raw-source",
          },
          meta: {},
          transactional: false,
          stopPropagation() {},
          isPropagationStopped() {
            return false;
          },
          tags: [],
        },
        "relay:",
      ),
    ).toBe(true);
  });

  it("keeps raw hook ids in allowlists when no store is provided", () => {
    const event = r.event("tests-event-lanes-internals-event").build();
    const lane = r.eventLane("tests-event-lanes-internals-lane").build();
    const queue = {
      enqueue: async () => "msg-1",
      consume: async () => {},
      ack: async () => {},
      nack: async () => {},
    };
    const hook = r
      .hook("tests-event-lanes-internals-hook")
      .on(event)
      .run(async () => {})
      .build();

    const context = buildEventLanesContext(
      {
        profile: "worker",
        topology: {
          profiles: {
            worker: {
              consume: [{ lane, hooks: { only: [hook] } }],
            },
          },
          bindings: [{ lane, queue }],
        },
      },
      [{ lane, queue }],
      new Set(),
      new Map(),
    );

    expect(context.hookAllowlistByLaneId.get(lane.id)).toEqual(
      new Set([hook.id]),
    );
  });
});
