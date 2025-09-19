import { CircularDependenciesError } from "../errors";

describe("Errors: CircularDependenciesError guidance without middleware", () => {
  it("omits middleware-specific guidance when cycles lack 'middleware'", () => {
    const cycles = [
      "taskA -> taskB -> taskA",
      "resourceX -> resourceY -> resourceX",
    ];
    const err = new CircularDependenciesError(cycles);
    expect(err.message).toContain("Circular dependencies detected:");
    expect(err.message).toContain("taskA -> taskB -> taskA");
    expect(err.message).not.toContain("For middleware");
  });
});
