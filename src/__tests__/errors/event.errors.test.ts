import {
  eventCycleError,
  eventCycleDepthExceededError,
  executionCycleError,
  executionDepthExceededError,
} from "../../errors";

describe("event errors", () => {
  it("formats event cycles with source ids when source paths are absent", () => {
    const error = eventCycleError.create({
      path: [
        {
          id: "event.alpha",
          source: {
            kind: "runtime",
            id: "relay.raw-source",
          },
        },
      ],
    });

    expect(error.message).toContain("event.alpha<-runtime:relay.raw-source");
  });

  it("formats execution cycle error with trace info", () => {
    const error = executionCycleError.create({
      frame: {
        kind: "event",
        id: "e1",
        source: { kind: "hook", id: "h1", path: "hooks/h1" },
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
          source: { kind: "hook", id: "h1", path: "hooks/h1" },
        },
        {
          kind: "event",
          id: "e1",
          source: { kind: "hook", id: "h1", path: "hooks/h1" },
        },
      ],
    });

    expect(error.message).toContain("Execution cycle detected");
    expect(error.message).toContain("event");
    expect(error.message).toContain("e1");
    expect(error.message).toContain("3 times");
  });

  it("formats execution depth exceeded error", () => {
    const error = executionDepthExceededError.create({
      frame: { kind: "task", id: "t1" },
      currentDepth: 1000,
      maxDepth: 1000,
    });

    expect(error.message).toContain("depth");
    expect(error.message).toContain("1000");
  });

  it("formats legacy eventCycleDepthExceededError", () => {
    const error = eventCycleDepthExceededError.create({
      eventId: "deep-event",
      currentDepth: 500,
      maxDepth: 500,
    });

    expect(error.message).toContain("500");
    expect(error.message).toContain("deep-event");
    expect(error.remediation).toContain("deep-event");
  });
});
