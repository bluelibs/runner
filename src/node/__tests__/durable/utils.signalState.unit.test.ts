import {
  parseSignalState,
  shouldPersistStableSignalId,
} from "../../durable/core/utils";

describe("durable: signal state utils", () => {
  it("parses completed and timed-out signal states", () => {
    expect(parseSignalState({ state: "completed", signalId: "paid" })).toEqual({
      state: "completed",
      signalId: "paid",
    });
    expect(parseSignalState({ state: "timed_out" })).toEqual({
      state: "timed_out",
      signalId: undefined,
    });
  });

  it("returns null for non-record and unknown signal states", () => {
    expect(parseSignalState(null)).toBeNull();
    expect(parseSignalState({ state: "nope" })).toBeNull();
  });

  it("persists stable signal ids only for non-canonical step ids", () => {
    expect(shouldPersistStableSignalId("__signal:paid", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:paid:1", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:stable-paid", "paid")).toBe(
      true,
    );
  });
});
