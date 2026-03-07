import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";

describe("system namespace separation", () => {
  it("uses system.tags.internal as the built-in internal tag", () => {
    expect(globalTags.system.id).toBe("system.tags.internal");
    expect(globalTags.internal.id).toBe("system.tags.internal");
  });

  it("keeps privileged container resources under the system.* namespace", () => {
    expect(globalResources.store.id).toBe("system.store");
    expect(globalResources.taskRunner.id).toBe("system.taskRunner");
    expect(globalResources.runtime.id).toBe("system.runtime");
    expect(globalResources.middlewareManager.id).toBe(
      "system.middlewareManager",
    );
    expect(globalResources.eventManager.id).toBe("system.eventManager");
  });

  it("does not expose the removed containerInternals tag", () => {
    expect(
      "containerInternals" in
        (globalTags as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});
