import {
  parseExecutionWaitState,
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

  it("parses execution wait states and rejects malformed ones", () => {
    expect(
      parseExecutionWaitState({
        state: "waiting",
        targetExecutionId: "child",
        timeoutAtMs: 10,
        timerId: "timer-1",
      }),
    ).toEqual({
      state: "waiting",
      targetExecutionId: "child",
      timeoutAtMs: 10,
      timerId: "timer-1",
    });
    expect(
      parseExecutionWaitState({
        state: "completed",
        targetExecutionId: "child",
        workflowKey: "child-task",
        result: { ok: true },
      }),
    ).toEqual({
      state: "completed",
      targetExecutionId: "child",
      workflowKey: "child-task",
      result: { ok: true },
    });
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child",
        error: { message: "boom", stack: "stack" },
        workflowKey: "child-task",
        attempt: 2,
      }),
    ).toEqual({
      state: "failed",
      targetExecutionId: "child",
      error: { message: "boom", stack: "stack" },
      workflowKey: "child-task",
      attempt: 2,
    });
    expect(
      parseExecutionWaitState({
        state: "timed_out",
        targetExecutionId: "child",
      }),
    ).toEqual({
      state: "timed_out",
      targetExecutionId: "child",
    });

    expect(parseExecutionWaitState(null)).toBeNull();
    expect(parseExecutionWaitState({ state: "waiting" })).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child",
        error: { nope: true },
        workflowKey: "child-task",
        attempt: 2,
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "unknown",
        targetExecutionId: "child",
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "completed",
        targetExecutionId: "child",
        result: { ok: true },
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "cancelled",
        targetExecutionId: "child",
        error: { message: "stopped" },
        workflowKey: "child-task",
        attempt: 3,
      }),
    ).toEqual({
      state: "cancelled",
      targetExecutionId: "child",
      error: { message: "stopped", stack: undefined },
      workflowKey: "child-task",
      attempt: 3,
    });
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child",
        error: { message: "boom" },
        workflowKey: "child-task",
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child",
        error: { message: "boom" },
        attempt: 2,
      }),
    ).toBeNull();
  });

  it("persists stable signal ids only for non-canonical step ids", () => {
    expect(shouldPersistStableSignalId("__signal:paid", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:paid:1", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:stable-paid", "paid")).toBe(
      true,
    );
  });
});
