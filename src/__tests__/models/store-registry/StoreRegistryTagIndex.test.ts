import { defineResource, defineTag, defineTask } from "../../../define";
import { VisibilityTracker } from "../../../models/VisibilityTracker";
import { StoreRegistryTagIndex } from "../../../models/store-registry/StoreRegistryTagIndex";
import { IndexedTagCategory } from "../../../models/store-registry/types";

describe("StoreRegistryTagIndex", () => {
  it("supports deprecated task and resource wrapper accessors", () => {
    const tag = defineTag({
      id: "tag-index.coverage.tag",
    });
    const task = defineTask({
      id: "tag-index.coverage.task",
      tags: [tag],
      run: async () => "ok",
    });
    const resource = defineResource({
      id: "tag-index.coverage.resource",
      tags: [tag],
      init: async () => "ok",
    });
    const collections = {
      tasks: new Map([[task.id, { task }]]),
      resources: new Map([[resource.id, { resource }]]),
      events: new Map(),
      hooks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      errors: new Map(),
      tags: new Map(),
    };
    const tagIndex = new StoreRegistryTagIndex(
      collections as any,
      new VisibilityTracker() as any,
    );

    tagIndex.reindexDefinitionTags(IndexedTagCategory.Tasks, task.id, [tag]);
    tagIndex.reindexDefinitionTags(IndexedTagCategory.Resources, resource.id, [
      tag,
    ]);

    expect(tagIndex.getTasksWithTag(tag)).toEqual([task]);
    expect(tagIndex.getResourcesWithTag(tag)).toEqual([resource]);
  });
});
