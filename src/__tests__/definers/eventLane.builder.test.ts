import { defineEventLane, isEventLane } from "../../define";
import { definitions, r } from "../..";

describe("event lane builder", () => {
  it("builds event lanes via defineEventLane", () => {
    const lane = defineEventLane({
      id: "tests.event-lanes.direct",
      meta: { title: "Direct Lane" },
    });

    expect(lane.id).toBe("tests.event-lanes.direct");
    expect(lane.meta.title).toBe("Direct Lane");
    expect(isEventLane(lane)).toBe(true);
    expect(
      (lane as unknown as Record<symbol, unknown>)[definitions.symbolFilePath],
    ).toContain("eventLane.builder.test");
  });

  it("builds event lanes via r.eventLane()", () => {
    const lane = r
      .eventLane("tests.event-lanes.builder")
      .meta({ title: "Builder Lane", description: "test" })
      .build();

    expect(lane.id).toBe("tests.event-lanes.builder");
    expect(lane.meta).toEqual({
      title: "Builder Lane",
      description: "test",
    });
    expect(isEventLane(lane)).toBe(true);
  });

  it("supports title() and description() fluent helpers", () => {
    const lane = r
      .eventLane("tests.event-lanes.builder.title-description")
      .title("Lane Title")
      .description("Lane Description")
      .build();

    expect(lane.meta).toEqual({
      title: "Lane Title",
      description: "Lane Description",
    });
  });

  it("supports applyTo() with event definitions and ids", () => {
    const event = r.event("tests.event-lanes.builder.apply-to.event").build();
    const lane = r
      .eventLane("tests.event-lanes.builder.apply-to")
      .applyTo([event, "tests.event-lanes.builder.apply-to.event"])
      .build();

    expect(lane.applyTo).toEqual([
      event,
      "tests.event-lanes.builder.apply-to.event",
    ]);
  });

  it("lets meta() override title()/description() values", () => {
    const lane = r
      .eventLane("tests.event-lanes.builder.meta-precedence")
      .title("initial title")
      .description("initial description")
      .meta({
        title: "final title",
        description: "final description",
      })
      .build();

    expect(lane.meta).toEqual({
      title: "final title",
      description: "final description",
    });
  });

  it("defaults meta to an empty object when missing", () => {
    const lane = defineEventLane({
      id: "tests.event-lanes.meta-default",
    });

    expect(lane.meta).toEqual({});
    expect(isEventLane(lane)).toBe(true);
  });

  it("builds frozen topology with lane-aware profile typing helper", () => {
    const laneA = r.eventLane("tests.event-lanes.topology.helper.a").build();
    const laneB = r.eventLane("tests.event-lanes.topology.helper.b").build();

    const topology = r.eventLane.topology({
      profiles: {
        worker: { consume: [laneA, laneB] },
      },
      bindings: [
        { lane: laneA, queue: { id: "queue-a" } },
        { lane: laneB, queue: { id: "queue-b" } },
      ],
    });

    expect(topology.profiles.worker.consume).toEqual([laneA, laneB]);
    expect(Object.isFrozen(topology)).toBe(true);
  });
});
