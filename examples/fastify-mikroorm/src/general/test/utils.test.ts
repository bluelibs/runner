import { buildTestRunner } from "./utils";
import { r } from "@bluelibs/runner";

describe("test utils", () => {
  it("builds runner without debug by default", async () => {
    const res = r.resource("x").init(async () => ({})).build();
    const rr = await buildTestRunner({ register: [res] });
    await rr.dispose();
  });

  it("supports debug option pass-through", async () => {
    const res = r.resource("y").init(async () => ({})).build();
    const rr = await buildTestRunner({ register: [res], debug: "normal" });
    await rr.dispose();
  });
});

