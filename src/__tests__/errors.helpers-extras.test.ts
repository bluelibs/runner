import {
  contextError,
  resourceNotFoundError,
  platformUnsupportedFunctionError,
} from "../errors";

describe("error helpers extra branches", () => {
  it("contextError default message branch", () => {
    try {
      // no details -> uses fallback branch
      contextError.throw({});
    } catch (e: any) {
      expect(String(e?.message)).toBe("Context error");
    }
  });

  it("resourceNotFoundError message", () => {
    try {
      resourceNotFoundError.throw({ id: "x" });
    } catch (e: any) {
      expect(String(e?.message)).toContain('Resource "x" not found.');
    }
  });

  it("platformUnsupportedFunctionError smoke", () => {
    try {
      platformUnsupportedFunctionError.throw({ functionName: "testFn" });
    } catch (e: any) {
      expect(String(e?.message)).toContain("Platform function not supported");
    }
  });
});
