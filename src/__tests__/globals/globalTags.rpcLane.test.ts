import { globalTags } from "../../globals/globalTags";
import { r } from "../..";

describe("r.runner.tags.rpcLane", () => {
  it("is scoped to tasks/events and extracts lane config", () => {
    expect(globalTags.rpcLane.targets).toEqual(["tasks", "events"]);
    expect(Object.isFrozen(globalTags.rpcLane.targets)).toBe(true);

    const lane = r.rpcLane("tests.global-tags.rpc-lane").build();

    const task = r
      .task("tests.global-tags.rpc-lane.task")
      .tags([globalTags.rpcLane.with({ lane })])
      .run(async () => "ok")
      .build();
    const event = r
      .event("tests.global-tags.rpc-lane.event")
      .tags([globalTags.rpcLane.with({ lane })])
      .build();

    expect(globalTags.rpcLane.extract(task)).toEqual({ lane });
    expect(globalTags.rpcLane.extract(event)).toEqual({ lane });
  });

  it("has resource-scoped rpcLanes tag", () => {
    expect(globalTags.rpcLanes.targets).toEqual(["resources"]);
    expect(Object.isFrozen(globalTags.rpcLanes.targets)).toBe(true);

    const resource = r
      .resource("tests.global-tags.rpc-lanes.resource")
      .tags([globalTags.rpcLanes])
      .build();

    expect(globalTags.rpcLanes.exists(resource)).toBe(true);
  });

  it("has task-scoped authValidator tag", () => {
    expect(globalTags.authValidator.targets).toEqual(["tasks"]);
    expect(Object.isFrozen(globalTags.authValidator.targets)).toBe(true);
  });
});
