import { globalTags } from "../../globals/globalTags";
import { r } from "../..";

describe("globals.tags.eventLane", () => {
  it("is scoped to events and extracts lane config", () => {
    const lane = r.eventLane("tests.global-tags.event-lane").build();

    const event = r
      .event("tests.global-tags.event-lane.event")
      .tags([
        globalTags.eventLane.with({
          lane,
          orderingKey: "order-1",
          metadata: { domain: "tests" },
        }),
      ])
      .build();

    const extracted = globalTags.eventLane.extract(event);
    expect(extracted).toEqual({
      lane,
      orderingKey: "order-1",
      metadata: { domain: "tests" },
    });
  });

  it("extracts lane hook config from hooks", () => {
    const lane = r.eventLane("tests.global-tags.event-lane.hook").build();
    const event = r.event("tests.global-tags.event-lane.hook.event").build();

    const hook = r
      .hook("tests.global-tags.event-lane.hook.definition")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    expect(globalTags.eventLaneHook.extract(hook)).toEqual({
      lane,
    });
  });
});
