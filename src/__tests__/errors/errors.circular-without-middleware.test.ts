import { circularDependenciesError } from "../../errors";

describe("Errors: CircularDependenciesError guidance without middleware", () => {
  it("omits middleware-specific guidance when cycles lack 'middleware'", () => {
    const cycles = [
      "taskA -> taskB -> taskA",
      "resourceX -> resourceY -> resourceX",
    ];
    try {
      circularDependenciesError.throw({ cycles });
    } catch (err: any) {
      expect(String(err?.message)).toContain("Circular dependencies detected:");
      expect(String(err?.message)).toContain("taskA -> taskB -> taskA");
      expect(String(err?.message)).not.toContain("For middleware");
    }
  });

  it("includes middleware-specific guidance when cycles mention middleware", () => {
    const cycles = ["middlewareA -> taskX -> middlewareA"];
    try {
      circularDependenciesError.throw({ cycles });
    } catch (err: any) {
      expect(String(err?.message)).toContain("For middleware");
    }
  });
});
