import { executionCycleError, executionDepthExceededError } from "../../errors";

describe("event errors", () => {
  it("formats execution cycle error with trace info", () => {
    const error = executionCycleError.new({
      frame: {
        kind: "event",
        id: "e1",
        source: { kind: "hook", id: "hooks.h1" },
      },
      repetitions: 3,
      maxRepetitions: 3,
      trace: [
        {
          kind: "event",
          id: "e1",
          source: { kind: "runtime", id: "initial" },
        },
        {
          kind: "hook",
          id: "h1",
          source: { kind: "hook", id: "hooks.h1" },
        },
        {
          kind: "event",
          id: "e1",
          source: { kind: "hook", id: "hooks.h1" },
        },
      ],
    });

    expect(error.message).toContain("Execution cycle detected");
    expect(error.message).toContain("event");
    expect(error.message).toContain("e1");
    expect(error.message).toContain("3 times");
  });

  it("formats execution depth exceeded error", () => {
    const error = executionDepthExceededError.new({
      frame: { kind: "task", id: "t1" },
      currentDepth: 1000,
      maxDepth: 1000,
    });

    expect(error.message).toContain("depth");
    expect(error.message).toContain("1000");
  });
});
