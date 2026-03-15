import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../index";

describe("hooks with multiple events (array on)", () => {
  it("should attach the hook to all events and run for each", async () => {
    const e1 = defineEvent<{ x: number }>({ id: "tests-events-e1" });
    const e2 = defineEvent<{ y: string }>({ id: "tests-events-e2" });

    const calls: Array<{ id: string; data: any }> = [];

    const h = defineHook({
      id: "tests-hooks-multi",
      on: [e1, e2] as const,
      run: async (ev) => {
        calls.push({ id: ev.id, data: ev.data });
      },
    });

    const app = defineResource({
      id: "tests-app-multi",
      register: [e1, e2, h],
      init: async () => {},
    });

    const harness = defineResource({
      id: "tests-harness-multi",
      register: [app],
    });

    const rr = await run(harness);
    await rr.emitEvent(e1, { x: 1 });
    await rr.emitEvent(e2, { y: "a" });

    const e1Id = rr.store.findIdByDefinition(e1);
    const e2Id = rr.store.findIdByDefinition(e2);

    expect(calls).toEqual([
      { id: e1Id, data: { x: 1 } },
      { id: e2Id, data: { y: "a" } },
    ]);

    await rr.dispose();
  });
});
