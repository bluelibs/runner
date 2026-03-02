import { globalTags } from "../../globals/globalTags";
import { r } from "../..";

describe("globals.tags.eventLane", () => {
  it("is scoped to events and extracts lane config", () => {
    expect(globalTags.eventLane.targets).toEqual(["events"]);
    expect(Object.isFrozen(globalTags.eventLane.targets)).toBe(true);

    const lane = r.eventLane("tests.global-tags.event-lane").build();

    const event = r
      .event("tests.global-tags.event-lane.event")
      .tags([
        globalTags.eventLane.with({
          lane,
        }),
      ])
      .build();

    const extracted = globalTags.eventLane.extract(event);
    expect(extracted).toEqual({
      lane,
    });
  });

  it("does not extract lane config from hooks", () => {
    const event = r.event("tests.global-tags.event-lane.hook.event").build();
    const hook = r
      .hook("tests.global-tags.event-lane.hook.definition")
      .on(event)
      .run(async () => {})
      .build();

    expect(globalTags.eventLane.extract(hook)).toBeUndefined();
  });
});
