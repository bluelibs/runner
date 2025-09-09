import { buildTestRunner } from "./utils";
import { resource } from "@bluelibs/runner";

describe("test utils", () => {
  it("builds runner without debug by default", async () => {
    const r = resource({ id: "x", init: async () => ({}) });
    const rr = await buildTestRunner({ register: [r] });
    await rr.dispose();
  });

  it("supports debug option pass-through", async () => {
    const r = resource({ id: "y", init: async () => ({}) });
    const rr = await buildTestRunner({ register: [r], debug: "normal" });
    await rr.dispose();
  });
});

