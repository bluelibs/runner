// This suite attempts to mimic attacker-like behaviors by trying to
// manipulate the EventManager via spoofed sources and self re-emission.
//
// The system’s intended properties under test:
// - Spoofing event source can only self-suppress a matching listener id.
// - Safe self re-emit (same hook id) should not create a cycle and should
//   still deliver to other listeners.
import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";
import { globals } from "../../index";

describe("Security: Hackish circumvention attempts", () => {
  it("source spoofing cannot suppress all listeners", async () => {
    // For a delivered event, the EventManager will skip the listener whose id
    // equals the event.source. Attempt to spoof the source to h1: h1 will be
    // skipped, but h2 and the global listener will still be invoked.
    const e = defineEvent<{ msg: string }>({ id: "sec.hack.e" });

    const seen: string[] = [];
    const h1 = defineHook({
      id: "sec.hack.h1",
      on: e,
      run: async () => {
        seen.push("h1");
      },
    });
    const h2 = defineHook({
      id: "sec.hack.h2",
      on: e,
      run: async () => {
        seen.push("h2");
      },
    });
    const star = defineHook({
      id: "sec.hack.star",
      on: "*",
      run: async () => {
        seen.push("star");
      },
    });

    const emitWithSpoof = defineTask<{ msg: string }>({
      id: "sec.hack.emitWithSpoof",
      dependencies: { eventManager: globals.resources.eventManager },
      run: async (input, { eventManager }) => {
        await eventManager.emit(e, input, h1.id); // spoof source as h1
      },
    });

    const app = defineResource({
      id: "sec.hack.app",
      register: [e, h1, h2, star, emitWithSpoof],
      init: async () => "ok",
    });

    const rr = await run(app);
    await rr.runTask(emitWithSpoof as any, { msg: "x" } as any);
    await rr.dispose();

    expect(seen).toContain("h2");
    expect(seen).toContain("star");
    expect(seen).not.toContain("h1"); // spoof only suppresses the matching hook
  });

  it("safe re-emit by same hook is allowed (idempotent pattern)", async () => {
    // A hook re-emitting the same event is allowed IF the source changes (e.g. initial->hook).
    // This supports idempotent patterns where a hook re-emits to notify others but skips itself.
    const e = defineEvent<{ step: number }>({ id: "sec.hack.reemit" });
    let countH = 0;
    let countSpy = 0;

    const h = defineHook({
      id: "sec.hack.h",
      on: e,
      dependencies: { eventManager: globals.resources.eventManager },
      run: async (ev, { eventManager }) => {
        countH++;
        if (ev.data.step === 0) {
          await eventManager.emit(e, { step: 1 }, "sec.hack.h");
        }
      },
    });

    const spy = defineHook({
      id: "sec.hack.spy",
      on: e,
      run: async () => {
        countSpy++;
      },
    });

    const app = defineResource({ id: "sec.hack.app2", register: [e, h, spy] });
    const rr = await run(app);

    await rr.emitEvent(e, { step: 0 });
    await rr.dispose();

    expect(countH).toBe(1); // self-skipped on re-emit
    expect(countSpy).toBe(2); // saw both emissions (step 0 and step 1)
  });

  // Note: exclusion from global hooks is already validated; spoofing source
  // cannot disable event-specific listeners (covered above), and RR.emitEvent
  // tests cover exclusion behavior explicitly.
});
