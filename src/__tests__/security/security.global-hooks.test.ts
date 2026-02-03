// This suite verifies that events tagged with globals.tags.excludeFromGlobalHooks
// are never dispatched to wildcard ("*") listeners. This is useful to reduce
// observability noise and to avoid accidental feedback loops from broad listeners.
import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { globals } from "../../index";

describe("Security: Global hooks scoping", () => {
  it("excludes events tagged excludeFromGlobalHooks from '*' listeners", async () => {
    // internalEvent carries the exclusion tag; publicEvent does not.
    // The star hook should only see publicEvent.
    const internalEvent = defineEvent<{ msg: string }>({
      id: "sec.events.internal",
      tags: [globals.tags.excludeFromGlobalHooks],
    });

    const publicEvent = defineEvent<{ msg: string }>({
      id: "sec.events.public",
    });

    const seen: string[] = [];
    const star = defineHook({
      id: "sec.hooks.star",
      on: "*",
      run: async (ev) => seen.push(ev.id),
    });

    const app = defineResource({
      id: "sec.app",
      register: [internalEvent, publicEvent, star],
      init: async () => "ok",
    });

    const rr = await run(app);
    await rr.emitEvent(publicEvent, { msg: "hello" });
    await rr.emitEvent(internalEvent, { msg: "secret" });

    expect(seen).toContain("sec.events.public");
    expect(seen).not.toContain("sec.events.internal");
    await rr.dispose();
  });
});
