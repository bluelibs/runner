// This test demonstrates a potential footgun: event definitions are mutable
// objects. Mutating event.tags at runtime changes how globals ("*") are
// considered for subsequent emissions. This is discouraged; treat definitions
// as immutable and prefer tags/overrides at definition time.
import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { globals, r } from "../../index";

describe("Security: Mutation footgun (documented)", () => {
  it("mutating event.tags toggles global inclusion for later emissions", async () => {
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

    // Now add the exclusion tag dynamically and verify star stops seeing it for future emissions
    (internal as any).tags = [globals.tags.excludeFromGlobalHooks];
    await rr.emitEvent(internal, { x: 2 });
    // Count how many times star saw this event id
    const count = seen.filter((id) => id === "sec.mut.internal").length;
    expect(count).toBe(1); // didn't increase after adding exclusion tag

    await rr.dispose();
  });

  it("fluent-built events are immutable and prevent the same mutation footgun", () => {
    const internal = r.event<{ x: number }>("sec.mut.fluent.internal").build();
    const previousTags = internal.tags;

    expect(Object.isFrozen(internal)).toBe(true);
    try {
      (internal as { tags: unknown }).tags = [
        globals.tags.excludeFromGlobalHooks,
      ];
    } catch (_error) {
      // Mutation may throw in strict mode; either way the object must remain unchanged.
    }
    expect(internal.tags).toBe(previousTags);
  });
});
