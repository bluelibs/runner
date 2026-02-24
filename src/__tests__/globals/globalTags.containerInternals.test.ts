import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";

describe("globals.tags.containerInternals", () => {
  it("is available as a built-in global tag", () => {
    expect(globalTags.containerInternals.id).toBe(
      "globals.tags.containerInternals",
    );
  });

  it("is attached to privileged container resources", () => {
    const expectedTagId = globalTags.containerInternals.id;

    expect(
      globalResources.store.tags.some((tag) => tag.id === expectedTagId),
    ).toBe(true);
    expect(
      globalResources.taskRunner.tags.some((tag) => tag.id === expectedTagId),
    ).toBe(true);
    expect(
      globalResources.runtime.tags.some((tag) => tag.id === expectedTagId),
    ).toBe(true);
    expect(
      globalResources.middlewareManager.tags.some(
        (tag) => tag.id === expectedTagId,
      ),
    ).toBe(true);
  });
});
