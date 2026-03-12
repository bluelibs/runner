import * as checkExports from "../../tools/check";

describe("tools/check exports", () => {
  it("exports the public check error classes", () => {
    expect(typeof checkExports.MatchError).toBe("function");
    expect(typeof checkExports.MatchPatternError).toBe("function");
    expect(typeof checkExports.CheckOptionsError).toBe("function");
  });
});
