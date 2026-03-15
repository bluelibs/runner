import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";

describe("system namespace separation", () => {
  it("uses the built-in internal tag without exposing a duplicate alias", () => {
    expect(globalTags.system.id).toBe("internal");
    expect((globalTags as unknown as Record<string, unknown>).internal).toBe(
      undefined,
    );
  });

  it("stores privileged container resources under local built-in ids", () => {
    expect(globalResources.store.id).toBe("store");
    expect(globalResources.taskRunner.id).toBe("taskRunner");
    expect(globalResources.runtime.id).toBe("runtime");
    expect(globalResources.middlewareManager.id).toBe("middlewareManager");
    expect(globalResources.eventManager.id).toBe("eventManager");
  });

  it("stores runner-owned resources under local built-in ids", () => {
    expect(globalResources.health.id).toBe("health");
    expect(globalResources.timers.id).toBe("timers");
  });

  it("does not expose the removed containerInternals tag", () => {
    expect(
      "containerInternals" in
        (globalTags as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});
