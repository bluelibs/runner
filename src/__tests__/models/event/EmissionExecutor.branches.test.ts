import { EventEmissionFailureMode } from "../../../defs";
import {
  executeInParallel,
  executeSequentially,
  executeTransactionally,
} from "../../../models/event/EmissionExecutor";
import { transactionalRollbackFailureError } from "../../../errors";
import { runtimeSource } from "../../../types/runtimeSource";

describe("EmissionExecutor branches", () => {
  function createEvent(id: string, signal = new AbortController().signal) {
    return {
      id,
      data: undefined,
      timestamp: new Date(),
      signal,
      source: runtimeSource.runtime(`test-source-${id}`),
      meta: {},
      transactional: false,
      isPropagationStopped: () => false,
      stopPropagation: () => undefined,
      tags: [],
    };
  }

  it("preserves listener metadata when thrown error already includes it", async () => {
    const error = Object.assign(new Error("boom"), {
      listenerId: "pre-set-listener",
      listenerOrder: 99,
    });

    const report = await executeSequentially({
      listeners: [
        {
          id: "listener-actual",
          order: 1,
          isGlobal: false,
          handler: async () => {
            throw error;
          },
        },
      ],
      event: createEvent("event-id"),
      failureMode: EventEmissionFailureMode.Aggregate,
    });

    expect(report.failedListeners).toBe(1);
    expect(report.errors[0]?.listenerId).toBe("pre-set-listener");
    expect(report.errors[0]?.listenerOrder).toBe(99);
  });

  it("normalizes object errors with non-string message fields", async () => {
    const report = await executeSequentially({
      listeners: [
        {
          id: "listener-object-message",
          order: 1,
          isGlobal: false,
          handler: async () => {
            throw { message: 123 };
          },
        },
      ],
      event: createEvent("event-id-object-message"),
      failureMode: EventEmissionFailureMode.Aggregate,
    });

    expect(report.failedListeners).toBe(1);
    expect(report.errors[0]?.message).toBe("[object Object]");
  });

  it("fails fast before sequential execution starts when the event signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("sequential pre-aborted");

    try {
      await executeSequentially({
        listeners: [],
        event: createEvent("event-sequential-pre", controller.signal),
        failureMode: EventEmissionFailureMode.FailFast,
      });
      fail("Expected sequential execution to reject");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("sequential pre-aborted");
    }
  });

  it("stops sequential execution before the next listener when the signal aborts", async () => {
    const controller = new AbortController();
    const runs: string[] = [];

    try {
      await executeSequentially({
        listeners: [
          {
            id: "listener-1",
            order: 0,
            isGlobal: false,
            handler: async () => {
              runs.push("listener-1");
              controller.abort("stop after one");
            },
          },
          {
            id: "listener-2",
            order: 1,
            isGlobal: false,
            handler: async () => {
              runs.push("listener-2");
            },
          },
        ],
        event: createEvent("event-sequential-mid", controller.signal),
        failureMode: EventEmissionFailureMode.FailFast,
      });
      fail("Expected sequential execution to reject after abort");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("stop after one");
    }

    expect(runs).toEqual(["listener-1"]);
  });

  it("fails fast before transactional execution starts when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("transactional pre-aborted");

    try {
      await executeTransactionally({
        listeners: [],
        event: createEvent("event-transactional-pre", controller.signal),
      });
      fail("Expected transactional execution to reject");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("transactional pre-aborted");
    }
  });

  it("includes rollback failures when cancellation interrupts a transactional event", async () => {
    const controller = new AbortController();

    try {
      await executeTransactionally({
        listeners: [
          {
            id: "listener-1",
            order: 0,
            isGlobal: false,
            handler: async () => {
              controller.abort("cancel tx");
              return async () => {
                throw new Error("undo exploded");
              };
            },
          },
          {
            id: "listener-2",
            order: 1,
            isGlobal: false,
            handler: async () => {
              return async () => undefined;
            },
          },
        ],
        event: createEvent("event-transactional-cancel", controller.signal),
      });
      fail("Expected transactional cancellation rollback failure");
    } catch (error) {
      expect(transactionalRollbackFailureError.is(error)).toBe(true);
      expect((error as any).cause.id).toBe("cancellation");
      expect((error as any).cause.message).toContain("cancel tx");
      expect((error as any).triggerError.id).toBe("cancellation");
      expect((error as any).triggerError.message).toContain("cancel tx");
      expect((error as any).rollbackErrors).toEqual([
        expect.objectContaining({
          listenerId: "listener-1",
          message: "undo exploded",
        }),
      ]);
    }
  });

  it("fails fast before parallel execution starts when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("parallel pre-aborted");

    try {
      await executeInParallel({
        listeners: [],
        event: createEvent("event-parallel-pre", controller.signal),
        failureMode: EventEmissionFailureMode.FailFast,
      });
      fail("Expected parallel execution to reject");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("parallel pre-aborted");
    }
  });

  it("rejects after the last parallel batch settles when that batch aborts the signal", async () => {
    const controller = new AbortController();
    const runs: string[] = [];

    try {
      await executeInParallel({
        listeners: [
          {
            id: "listener-1",
            order: 0,
            isGlobal: false,
            handler: async () => {
              runs.push("listener-1");
              controller.abort("parallel stop");
            },
          },
        ],
        event: createEvent("event-parallel-post-batch", controller.signal),
        failureMode: EventEmissionFailureMode.FailFast,
      });
      fail("Expected parallel execution to reject after abort");
    } catch (error) {
      expect((error as any).id).toBe("cancellation");
      expect((error as Error).message).toContain("parallel stop");
    }

    expect(runs).toEqual(["listener-1"]);
  });
});
