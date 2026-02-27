import { normalizeErrorMessage } from "../../event-lanes/EventLanesInternals";

describe("EventLanesInternals", () => {
  it("normalizes non-Error values into string messages", () => {
    expect(normalizeErrorMessage("primitive-error")).toBe("primitive-error");
  });
});
