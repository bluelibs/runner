import { circularDependencyError } from "../../errors";

describe("Errors: circularDependencyError guidance without middleware", () => {
  it("omits middleware-specific guidance when cycles lack 'middleware'", () => {
    expect.assertions(3);
    const cycles = [
      "taskA -> taskB -> taskA",
      "resourceX -> resourceY -> resourceX",
    ];
    try {
      circularDependencyError.throw({ cycles });
    } catch (err: any) {
      expect(String(err?.message)).toContain("Circular dependencies detected:");
      expect(String(err?.message)).toContain("taskA -> taskB -> taskA");
      expect(String(err?.message)).not.toContain("For middleware");
    }
  });

  it("includes middleware-specific guidance when cycles mention middleware", () => {
    expect.assertions(2);
    const cycles = ["middlewareA -> taskX -> middlewareA"];
    try {
      circularDependencyError.throw({ cycles });
    } catch (err: any) {
      expect(String(err?.message)).toContain("taskRunner.intercept");
      expect(String(err?.message)).toContain("subtree-scoped middleware");
    }
  });
});
