import { globalTags } from "../../../globals/globalTags";
import { r, run } from "../../..";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";

describe("eventLanes deprecated tags", () => {
  it("fails fast when an event uses deprecated tags.eventLane", async () => {
    const lane = r.eventLane("tests-event-lanes-deprecated-event-tag").build();
    const event = r
      .event("tests-event-lanes-deprecated-event-tag-event")
      .tags([globalTags.eventLane.with({ lane })])
      .build();

    const app = r
      .resource("tests-event-lanes-deprecated-event-tag-app")
      .register([
        event,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [] } },
            bindings: [],
          },
        }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(/uses deprecated tag "eventLane"/i);
  });
});
