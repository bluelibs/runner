import { r } from "../../../";

{
  const taskOnlyTag = r.tag("types.tag.targets.task").for(["tasks"]).build();
  const sharedTag = r
    .tag("types.tag.targets.shared")
    .for(["tasks", "resources"])
    .build();

  r.task("types.tag.targets.task.consumer")
    .tags([taskOnlyTag, sharedTag])
    .run(async () => undefined)
    .build();

  r.resource("types.tag.targets.resource.consumer")
    .tags([sharedTag])
    .build();

  r.resource("types.tag.targets.resource.invalid")
    .tags([
      // @ts-expect-error task-only tag cannot be attached to a resource
      taskOnlyTag,
    ])
    .build();
}

{
  // @ts-expect-error invalid target literal
  r.tag("types.tag.targets.invalidTarget").for(["etc"]);
}
