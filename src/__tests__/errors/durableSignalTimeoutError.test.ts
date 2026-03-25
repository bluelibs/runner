import { durableSignalTimeoutError } from "../../errors";

describe("durableSignalTimeoutError", () => {
  it("formats the timeout message and remediation with the signal id", () => {
    const error = durableSignalTimeoutError.new({
      signalId: "signals.approval",
    });

    expect(error.message).toContain("Signal 'signals.approval' timed out");
    expect(error.message).toContain(
      'Remediation: Emit signal "signals.approval" before timeout or increase timeout settings for this wait step.',
    );
    expect(error.remediation).toBe(
      'Emit signal "signals.approval" before timeout or increase timeout settings for this wait step.',
    );
  });
});
