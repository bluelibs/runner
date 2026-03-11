import { defineTag } from "../../../define";
import { StoreRegistryTagMatchCollector } from "../../../models/store-registry/StoreRegistryTagMatchCollector";
import type { TagIndexedCollections } from "../../../models/store-registry/types";

function createCollections(): TagIndexedCollections {
  return {
    tasks: new Map(),
    resources: new Map(),
    events: new Map(),
    hooks: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    errors: new Map(),
    tags: new Map(),
  };
}

describe("StoreRegistryTagMatchCollector", () => {
  it("returns empty resource matches when definition ids are missing or empty", () => {
    const collector = new StoreRegistryTagMatchCollector(createCollections());
    const tag = defineTag({
      id: "collector-tags-empty",
    });

    expect(
      collector.collectTaggedResourceMatches(tag, undefined, () => true),
    ).toEqual([]);
    expect(
      collector.collectTaggedResourceMatches(
        tag,
        new Set<string>(),
        () => true,
      ),
    ).toEqual([]);
  });
});
