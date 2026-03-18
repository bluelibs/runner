import { globalTags } from "../../globals/globalTags";
import { r } from "../..";

describe("tags.eventLane", () => {
  it("is scoped to events and extracts lane config", () => {
    expect(globalTags.eventLane.targets).toEqual(["events"]);
    expect(Object.isFrozen(globalTags.eventLane.targets)).toBe(true);

    const lane = r.eventLane("tests-global-tags-event-lane").build();

    const event = r
      .event("tests-global-tags-event-lane-event")
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
    const event = r.event("tests-global-tags-event-lane-hook-event").build();
    const hook = r
      .hook("tests-global-tags-event-lane-hook-definition")
      .on(event)
      .run(async () => {})
      .build();

    expect(globalTags.eventLane.extract(hook)).toBeUndefined();
  });
});

describe("tags.eventLaneHook", () => {
  it("is scoped to hooks and extracts a single-lane config", () => {
    expect(globalTags.eventLaneHook.targets).toEqual(["hooks"]);
    expect(Object.isFrozen(globalTags.eventLaneHook.targets)).toBe(true);

    const lane = r.eventLane("tests-global-tags-event-lane-hook").build();
    const event = r.event("tests-global-tags-event-lane-hook-event2").build();
    const hook = r
      .hook("tests-global-tags-event-lane-hook-tagged")
      .on(event)
      .tags([globalTags.eventLaneHook.with({ lane })])
      .run(async () => {})
      .build();

    expect(globalTags.eventLaneHook.extract(hook)).toEqual({ lane });
  });

  it("does not extract lane hook config from events", () => {
    const lane = r.eventLane("tests-global-tags-event-lane-hook-scope").build();
    const event = r
      .event("tests-global-tags-event-lane-hook-wrong-scope")
      .tags([globalTags.eventLane.with({ lane })])
      .build();

    expect(globalTags.eventLaneHook.extract(event)).toBeUndefined();
  });

  it("fails fast when lane is missing or legacy lanes is used", () => {
    expect(() => globalTags.eventLaneHook.with({} as never)).toThrow();
    expect(() =>
      globalTags.eventLaneHook.with({
        lanes: [
          r.eventLane("tests-global-tags-event-lane-hook-legacy-many").build(),
        ],
      } as never),
    ).toThrow();
  });
});
