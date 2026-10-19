import { setup } from "./execute.fixture";
import { runtimeSource } from "../../../../types/runtimeSource";
import { cancellationError } from "../../../../errors";
import {
  SuspensionSignal,
  ContinuationSignal,
} from "../../../durable/core/interfaces/context";
import { EXECUTION_PAUSED_ABORT_REASON } from "../../../durable/core/pauseInterruption";
import { runtimeShutdownAbortReason } from "../../../../tools/runtimeShutdownAbortReason";

describe("persisted event execution contracts", () => {
  it("fails before effects when an event or its ordered plan is missing", async () => {
    const effect = jest.fn(async () => "receipt");
    const fixture = await setup(effect);
    try {
      await expect(fixture.execute({ eventId: "missing" })).rejects.toThrow(
        "no longer registered",
      );
      await expect(fixture.execute({ hookIds: ["missing"] })).rejects.toThrow(
        "hook plan changed",
      );
      expect(effect).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("preserves source-aware hook self-skip and optional event metadata", async () => {
    const effect = jest.fn(async () => "receipt");
    const fixture = await setup(effect);
    try {
      const entry = fixture.store.events.get(fixture.input.eventId)!;
      const get = fixture.store.events.get.bind(fixture.store.events);
      jest
        .spyOn(fixture.store.events, "get")
        .mockImplementation((id) =>
          id === fixture.input.eventId
            ? { event: { ...entry.event, meta: undefined } }
            : get(id),
        );
      expect(
        await fixture.execute({
          source: runtimeSource.hook(fixture.input.hookIds[0]),
        }),
      ).toMatchObject({ skippedListeners: 1, attemptedListeners: 0 });
      expect(effect).not.toHaveBeenCalled();
      await fixture.execute();
      expect(effect).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it("retains a non-Error business failure and non-Error undo diagnostics", async () => {
    let calls = 0;
    const fixture = await setup(
      async () => {
        if (++calls > 1) throw "business failed";
        return "receipt";
      },
      async () => {
        throw "undo failed";
      },
    );
    try {
      await fixture.execute();
      await fixture.backend.saveStepResult({
        executionId: "execution",
        stepId: "eventFailure",
        result: { failure: { message: "business failed" } },
        completedAt: new Date(),
      });
      await expect(fixture.execute({ compensation: true })).rejects.toThrow(
        "undo failed",
      );
      expect(
        (await fixture.backend.getExecution("execution"))!.error!.message,
      ).toContain("business failed");
    } finally {
      await fixture.close();
    }
  });

  it.each([new SuspensionSignal("sleep"), new ContinuationSignal(undefined)])(
    "rejects hook-owned durable control flow: %s",
    async (error) => {
      const fixture = await setup(async () => {
        throw error;
      });
      try {
        await expect(fixture.execute()).rejects.toThrow("cannot suspend");
      } finally {
        await fixture.close();
      }
    },
  );

  it.each([EXECUTION_PAUSED_ABORT_REASON, runtimeShutdownAbortReason])(
    "does not compensate an interrupted forward hook: %s",
    async (reason) => {
      const undo = jest.fn(async () => {});
      const fixture = await setup(async () => {
        throw cancellationError.new({ reason });
      }, undo);
      try {
        await expect(fixture.execute({ compensation: true })).rejects.toThrow();
        expect(undo).not.toHaveBeenCalled();
        expect(
          await fixture.backend.getStepResult("execution", "eventFailure"),
        ).toBeNull();
      } finally {
        await fixture.close();
      }
    },
  );

  it.each([EXECUTION_PAUSED_ABORT_REASON, runtimeShutdownAbortReason])(
    "parks interrupted undo without recording compensation failure: %s",
    async (reason) => {
      const fixture = await setup(
        async () => "receipt",
        async () => {
          throw cancellationError.new({ reason });
        },
      );
      try {
        await fixture.execute();
        await fixture.backend.saveStepResult({
          executionId: "execution",
          stepId: "eventFailure",
          result: { failure: { message: "failed" } },
          completedAt: new Date(),
        });
        await expect(fixture.execute({ compensation: true })).rejects.toThrow();
        expect((await fixture.backend.getExecution("execution"))!.status).toBe(
          "running",
        );
      } finally {
        await fixture.close();
      }
    },
  );

  it("keeps a concurrent pause out of compensation", async () => {
    const fixture = await setup(async () => {
      await pause();
      throw new Error("interrupted");
    });
    const pause = async () => {
      const execution = (await fixture.backend.getExecution("execution"))!;
      await fixture.backend.saveExecution({ ...execution, status: "paused" });
    };
    try {
      await expect(fixture.execute({ compensation: true })).rejects.toThrow(
        "interrupted",
      );
    } finally {
      await fixture.close();
    }
  });

  it("preserves an operator pause racing with an undo failure", async () => {
    const fixture = await setup(
      async () => "receipt",
      async () => {
        await pause();
        throw new Error("undo failed");
      },
    );
    const pause = async () => {
      const execution = (await fixture.backend.getExecution("execution"))!;
      await fixture.backend.saveExecution({ ...execution, status: "paused" });
    };
    try {
      await fixture.execute();
      await fixture.backend.saveStepResult({
        executionId: "execution",
        stepId: "eventFailure",
        result: { failure: { message: "failed" } },
        completedAt: new Date(),
      });
      await expect(fixture.execute({ compensation: true })).rejects.toThrow(
        "Compensation failed",
      );
      expect((await fixture.backend.getExecution("execution"))!.status).toBe(
        "paused",
      );
    } finally {
      await fixture.close();
    }
  });

  it("keeps an undo recoverable when the effect succeeded but its checkpoint write failed", async () => {
    const fixture = await setup();
    try {
      await fixture.execute();
      await fixture.backend.saveStepResult({
        executionId: "execution",
        stepId: "eventFailure",
        result: { failure: { message: "failed" } },
        completedAt: new Date(),
      });
      const save = fixture.backend.saveStepResult.bind(fixture.backend);
      jest
        .spyOn(fixture.backend, "saveStepResult")
        .mockImplementation(async (result) => {
          if (result.stepId.startsWith("undo:"))
            throw new Error("checkpoint unavailable");
          return save(result);
        });
      await expect(fixture.execute({ compensation: true })).rejects.toThrow(
        "checkpoint unavailable",
      );
      expect(
        await fixture.backend.getStepResult(
          "execution",
          `undo:${fixture.input.hookIds[0]}`,
        ),
      ).toBeNull();
    } finally {
      await fixture.close();
    }
  });

  it("waits for forward retries to exhaust before compensating a non-Error failure", async () => {
    const fixture = await setup(async () => {
      throw "offline";
    });
    try {
      const execution = (await fixture.backend.getExecution("execution"))!;
      await fixture.backend.saveExecution({ ...execution, maxAttempts: 2 });
      await expect(fixture.execute({ compensation: true })).rejects.toBe(
        "offline",
      );
      expect(
        await fixture.backend.getStepResult("execution", "eventFailure"),
      ).toBeNull();
      await fixture.backend.saveExecution({ ...execution, maxAttempts: 1 });
      await expect(fixture.execute({ compensation: true })).rejects.toThrow(
        "offline",
      );
    } finally {
      await fixture.close();
    }
  });
});
