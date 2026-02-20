import { computeExecutionPlanFromWhitelist } from "../../globals/resources/tunnel/plan";

describe("tunnel plan", () => {
  it("computes execution plan from whitelist with defaults", () => {
    const plan = computeExecutionPlanFromWhitelist({
      client: ["a", { id: "b" }],
      server: ["c"],
    });
    expect(plan).toEqual({
      clientMiddleware: ["a", "b"],
      serverMiddleware: ["c"],
      validation: "both",
    });
  });

  it("supports defaultValidation override", () => {
    const plan = computeExecutionPlanFromWhitelist(
      {},
      { defaultValidation: "server" },
    );
    expect(plan.validation).toBe("server");
  });

  it("supports server whitelist with object ids (non-string branch)", () => {
    const plan = computeExecutionPlanFromWhitelist({
      server: [{ id: "s1" }],
    });
    expect(plan.serverMiddleware).toEqual(["s1"]);
  });
});
