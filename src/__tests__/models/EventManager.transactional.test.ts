import { defineEvent } from "../../define";
import { transactionalRollbackFailureError } from "../../errors";
import { EventManager } from "../../models/EventManager";
import { runtimeSource } from "../../types/runtimeSource";

describe("EventManager transactional execution", () => {
  let eventManager: EventManager;

  beforeEach(() => {
    eventManager = new EventManager();
  });

  it("runs listeners successfully without automatic rollback", async () => {
    const event = defineEvent<string>({
      id: "tx-success",
      transactional: true,
    });
    const execution: string[] = [];
    const rollbacks: string[] = [];

    eventManager.addListener(
      event,
      async (emission) => {
        execution.push(`l1:${emission.data}`);
        return async () => {
          rollbacks.push("undo-l1");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("l2");
        return async () => {
          rollbacks.push("undo-l2");
        };
      },
      { id: "l2", order: 1 },
    );

    await expect(
      eventManager.emit(event, "payload", runtimeSource.runtime("source")),
    ).resolves.toBeUndefined();

    expect(execution).toEqual(["l1:payload", "l2"]);
    expect(rollbacks).toEqual([]);
  });

  it("throws when a transactional event is also marked parallel", async () => {
    const invalidEvent = defineEvent<void>({
      id: "tx-invalid-parallel",
      transactional: true,
      parallel: true,
    });

    eventManager.addListener(
      invalidEvent,
      async () => {
        return async () => {};
      },
      { id: "l1", order: 0 },
    );

    await expect(
      eventManager.emit(invalidEvent, undefined, runtimeSource.runtime("src")),
    ).rejects.toMatchObject({
      id: "transactionalParallelConflict",
    });
  });

  it("rolls back completed listeners in reverse order when a listener fails", async () => {
    const event = defineEvent<void>({
      id: "tx-rollback-reverse",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        return async () => {
          execution.push("undo-1");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        return async () => {
          execution.push("undo-2");
        };
      },
      { id: "l2", order: 1 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-3");
        throw new Error("boom");
      },
      { id: "l3", order: 2 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-4");
        return async () => {};
      },
      { id: "l4", order: 3 },
    );

    await expect(
      eventManager.emit(event, undefined, runtimeSource.runtime("source")),
    ).rejects.toMatchObject({
      message: "boom",
      listenerId: "l3",
      listenerOrder: 2,
    });

    expect(execution).toEqual(["run-1", "run-2", "run-3", "undo-2", "undo-1"]);
  });

  it("treats missing undo closure as listener failure and triggers rollback", async () => {
    const event = defineEvent<void>({
      id: "tx-missing-undo",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        return async () => {
          execution.push("undo-1");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
      },
      { id: "l2", order: 1 },
    );

    await expect(
      eventManager.emit(event, undefined, runtimeSource.runtime("source")),
    ).rejects.toMatchObject({
      id: "transactionalMissingUndoClosure",
      listenerId: "l2",
      listenerOrder: 1,
    });

    expect(execution).toEqual(["run-1", "run-2", "undo-1"]);
  });

  it("continues rollback when rollback handlers fail and throws transactional rollback aggregate error", async () => {
    const event = defineEvent<void>({
      id: "tx-rollback-failures",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        return async () => {
          execution.push("undo-1");
          throw new Error("undo-1-failed");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        return async () => {
          execution.push("undo-2");
        };
      },
      { id: "l2", order: 1 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-3");
        throw new Error("trigger-failed");
      },
      { id: "l3", order: 2 },
    );

    try {
      await eventManager.emit(
        event,
        undefined,
        runtimeSource.runtime("source"),
      );
      fail("Expected transactional rollback aggregate error");
    } catch (error: unknown) {
      expect(transactionalRollbackFailureError.is(error)).toBe(true);
      expect(error).toMatchObject({
        id: "transactionalRollbackFailure",
      });

      const rollbackError = error as {
        triggerError: { message: string; listenerId: string };
        rollbackErrors: Array<{ message: string; listenerId: string }>;
      };
      expect(rollbackError.triggerError.message).toBe("trigger-failed");
      expect(rollbackError.triggerError.listenerId).toBe("l3");
      expect(rollbackError.rollbackErrors).toEqual([
        expect.objectContaining({ message: "undo-1-failed", listenerId: "l1" }),
      ]);
    }

    expect(execution).toEqual(["run-1", "run-2", "run-3", "undo-2", "undo-1"]);
  });

  it("does not rollback on propagation stop when no failure occurs", async () => {
    const event = defineEvent<void>({
      id: "tx-stop-propagation",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async (emission) => {
        execution.push("run-1");
        emission.stopPropagation();
        return async () => {
          execution.push("undo-1");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        return async () => {};
      },
      { id: "l2", order: 1 },
    );

    await eventManager.emit(event, undefined, runtimeSource.runtime("source"));

    expect(execution).toEqual(["run-1"]);
  });

  it("skipped listeners are not added to rollback stack", async () => {
    const event = defineEvent<void>({
      id: "tx-skip-rollback",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-skipped");
        return async () => {
          execution.push("undo-skipped");
        };
      },
      { id: "skip-me", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        return async () => {
          execution.push("undo-1");
        };
      },
      { id: "l1", order: 1 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        throw new Error("fail");
      },
      { id: "l2", order: 2 },
    );

    await expect(
      eventManager.emit(event, undefined, runtimeSource.runtime("skip-me")),
    ).rejects.toThrow("fail");

    expect(execution).toEqual(["run-1", "run-2", "undo-1"]);
  });

  it("forces fail-fast semantics even when aggregate mode is requested", async () => {
    const event = defineEvent<void>({
      id: "tx-fail-fast",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        throw new Error("first-failure");
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        return async () => {};
      },
      { id: "l2", order: 1 },
    );

    await expect(
      eventManager.emit(event, undefined, {
        source: runtimeSource.runtime("source"),
        failureMode: "aggregate",
        throwOnError: false,
      }),
    ).rejects.toThrow("first-failure");

    expect(execution).toEqual(["run-1"]);
  });

  it("exposes transactional flag on event emission info", async () => {
    const event = defineEvent<void>({
      id: "tx-emission-info",
      transactional: true,
    });
    const seen: boolean[] = [];

    eventManager.addListener(
      event,
      async (emission) => {
        seen.push(emission.transactional);
        return async () => {};
      },
      { id: "l1" },
    );

    await eventManager.emit(event, undefined, runtimeSource.runtime("source"));

    expect(seen).toEqual([true]);
  });

  it("rolls back completed listeners when cancellation is observed before the next transactional listener", async () => {
    const controller = new AbortController();
    const event = defineEvent<void>({
      id: "tx-cancelled-before-next",
      transactional: true,
    });
    const execution: string[] = [];

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-1");
        controller.abort("cancelled");
        return async () => {
          execution.push("undo-1");
        };
      },
      { id: "l1", order: 0 },
    );

    eventManager.addListener(
      event,
      async () => {
        execution.push("run-2");
        return async () => {};
      },
      { id: "l2", order: 1 },
    );

    await expect(
      eventManager.emit(event, undefined, {
        source: runtimeSource.runtime("source"),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ id: "cancellation" });

    expect(execution).toEqual(["run-1", "undo-1"]);
  });
});
