import { defineEvent, defineHook, defineResource } from "../define";
import { run } from "..";
import { eventNotFoundError } from "../errors";

describe("errors - multi-event hook with missing event", () => {
  it("should throw EventNotFoundError when one of the events is not registered", async () => {
    const e1 = defineEvent<{ x: number }>({ id: "tests.events.e1" });
    const missing = defineEvent<{ z: boolean }>({ id: "tests.events.missing" });

    const h = defineHook({
      id: "tests.hooks.multi.missing",
      on: [e1, missing] as const,
      run: async () => {},
    });

    const app = defineResource({
      id: "tests.app.multi.missing",
      register: [e1, h],
    });
    const harness = defineResource({
      id: "tests.harness.multi.missing",
      register: [app],
    });

    await expect(run(harness)).rejects.toThrow();
  });
});
