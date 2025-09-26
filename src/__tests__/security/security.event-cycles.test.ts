// This suite targets denial-of-service vectors via event emission cycles.
// If a hook emits an event that leads back to the same event in the same
// emission chain (A -> B -> A), the EventManager must detect and stop it.
//
// The goal is to verify the runtime guard (AsyncLocalStorage-based stack)
// catches cycles even when constructed indirectly through multiple hooks,
// and throws EventCycleError instead of hanging the event loop.
import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { eventCycleError } from "../../errors";
import { globals } from "../../index";

describe("Security: Event cycle detection", () => {
  it("prevents emission cycles (A -> B -> A)", async () => {
    // Two events that emit into each other via hooks are a classic cycle.
    // The first re-emit will push the same event id back onto the stack,
    // and the manager must throw an EventCycleError.
    const e1 = defineEvent<{ v: number }>({ id: "sec.events.e1" });
    const e2 = defineEvent<{ v: number }>({ id: "sec.events.e2" });

    // e1 emits e2; e2 emits e1 -> cycle
    const onE1 = defineHook({
      id: "sec.hooks.onE1",
      dependencies: { eventManager: globals.resources.eventManager },
      on: e1,
      run: async (ev, { eventManager }) => {
        await eventManager.emit(e2, { v: ev.data.v + 1 }, "test");
      },
    });

    const onE2 = defineHook({
      id: "sec.hooks.onE2",
      dependencies: { eventManager: globals.resources.eventManager },
      on: e2,
      run: async (ev, { eventManager }) => {
        await eventManager.emit(e1, { v: ev.data.v + 1 }, "test");
      },
    });

    const app = defineResource({
      id: "sec.app",
      register: [e1, e2, onE1, onE2],
      init: async () => "ok",
    });

    const rr = await run(app);
    await expect(rr.emitEvent(e1, { v: 1 })).rejects.toThrow();
    await rr.dispose();
  });
});
