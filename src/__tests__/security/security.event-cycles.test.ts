// Verifies the runtime execution trace guard catches event emission cycles
// (A -> B -> A) constructed indirectly through hooks, and throws a cycle
// error instead of hanging the event loop.
import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { resources } from "../../index";
import { runtimeSource } from "../../types/runtimeSource";

describe("Security: Event cycle detection", () => {
  it("prevents emission cycles (A -> B -> A)", async () => {
    const e1 = defineEvent<{ v: number }>({ id: "sec-events-e1" });
    const e2 = defineEvent<{ v: number }>({ id: "sec-events-e2" });

    // e1 emits e2; e2 emits e1 -> cycle
    const onE1 = defineHook({
      id: "sec-hooks-onE1",
      dependencies: { eventManager: resources.eventManager },
      on: e1,
      run: async (ev, { eventManager }) => {
        await eventManager.emit(
          e2,
          { v: ev.data.v + 1 },
          runtimeSource.runtime("test"),
        );
      },
    });

    const onE2 = defineHook({
      id: "sec-hooks-onE2",
      dependencies: { eventManager: resources.eventManager },
      on: e2,
      run: async (ev, { eventManager }) => {
        await eventManager.emit(
          e1,
          { v: ev.data.v + 1 },
          runtimeSource.runtime("test"),
        );
      },
    });

    const app = defineResource({
      id: "sec-app",
      register: [e1, e2, onE1, onE2],
      init: async () => "ok",
    });

    const rr = await run(app, { executionContext: true });
    await expect(rr.emitEvent(e1, { v: 1 })).rejects.toThrow(/cycle detected/i);
    await rr.dispose();
  });
});
