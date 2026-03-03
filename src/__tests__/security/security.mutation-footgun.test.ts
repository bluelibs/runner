// Event definitions are immutable by default. This prevents runtime tag
// mutation from changing global hook behavior after bootstrap.
import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { r } from "../../index";

describe("Security: Mutation footgun prevention", () => {
  it("blocks mutating direct-defined event tags at runtime", async () => {
    const internal = defineEvent<{ x: number }>({
      id: "sec.mut.internal",
      tags: [],
    });
    const seen: string[] = [];

    const star = defineHook({
      id: "sec.mut.star",
      on: "*",
      run: async (ev) => {
        seen.push(ev.id);
      },
    });
    const app = defineResource({
      id: "sec.mut.app",
      register: [internal, star],
    });

    const rr = await run(app);

    // First emit: no star exclusion tag, star should see it currently (baseline)
    await rr.emitEvent(internal, { x: 1 });
    expect(seen).toContain("sec.mut.internal");

    const previousTags = internal.tags;
    try {
      (internal as { tags: unknown }).tags = [
        r.runner.tags.excludeFromGlobalHooks,
      ];
    } catch (_error) {
      // Mutation may throw in strict mode; either way the object must remain unchanged.
    }

    expect(Object.isFrozen(internal)).toBe(true);
    expect(internal.tags).toBe(previousTags);

    await rr.emitEvent(internal, { x: 2 });
    const count = seen.filter((id) => id === "sec.mut.internal").length;
    expect(count).toBe(2);

    await rr.dispose();
  });

  it("fluent-built events are immutable and prevent the same mutation footgun", () => {
    const internal = r.event<{ x: number }>("sec.mut.fluent.internal").build();
    const previousTags = internal.tags;

    expect(Object.isFrozen(internal)).toBe(true);
    try {
      (internal as { tags: unknown }).tags = [
        r.runner.tags.excludeFromGlobalHooks,
      ];
    } catch (_error) {
      // Mutation may throw in strict mode; either way the object must remain unchanged.
    }
    expect(internal.tags).toBe(previousTags);
  });
});
