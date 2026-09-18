import {
  durableContinueAsNewRejectedError,
  durableLifecycleUnsupportedStoreCapabilityError,
  durablePauseRejectedError,
  durableRestartRejectedError,
  durableResumeRejectedError,
  durableWorkflowStateInvalidError,
  RunnerErrorId,
} from "../../../../../errors";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { DurableService } from "../../../../durable/core/DurableService";
import {
  ContinuationSignal,
  SuspensionSignal,
} from "../../../../durable/core/interfaces/context";
import {
  ExecutionStatus,
  isExecutionTerminal,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { SpyQueue } from "../../helpers/DurableService.unit.helpers";

function createService(): DurableService {
  return new DurableService({
    store: new MemoryStore(),
    queue: new SpyQueue(),
    tasks: [],
  });
}

function createContext(): DurableContext {
  return new DurableContext(
    new MemoryStore(),
    new MemoryEventBus(),
    "lifecycle-contract",
    1,
  );
}

describe("durable: lifecycle contract (U0)", () => {
  it("treats continued_as_new as terminal and paused as non-terminal", () => {
    expect(ExecutionStatus.Paused).toBe("paused");
    expect(ExecutionStatus.ContinuedAsNew).toBe("continued_as_new");
    expect(isExecutionTerminal(ExecutionStatus.ContinuedAsNew)).toBe(true);
    expect(isExecutionTerminal(ExecutionStatus.Paused)).toBe(false);
    expect(isExecutionTerminal(ExecutionStatus.Sleeping)).toBe(false);
    expect(isExecutionTerminal(ExecutionStatus.Running)).toBe(false);
  });

  it("exposes the lifecycle service surface (U1/U2 implement pause/resume/restart)", async () => {
    const service = createService();

    await expect(service.pauseExecution("e1")).rejects.toThrow(
      'Cannot pause execution "e1" with status "unknown".',
    );
    await expect(service.resumeExecution("e1")).rejects.toThrow(
      'Cannot resume execution "e1" with status "unknown": it is not paused.',
    );
    await expect(service.restartExecution("e1")).rejects.toThrow(
      'Cannot restart execution "e1" with status "unknown".',
    );
    await expect(service.getState("e1")).rejects.toThrow(
      'DurableService.getState("e1") is not implemented in this build.',
    );
  });

  it("exposes the lifecycle context surface (U3/U4 implement the behavior)", async () => {
    const ctx = createContext();

    await expect(ctx.continueAsNew({})).rejects.toThrow(
      'DurableContext.continueAsNew("lifecycle-contract") is not implemented in this build.',
    );
    await expect(ctx.setState({})).rejects.toThrow(
      'DurableContext.setState("lifecycle-contract") is not implemented in this build.',
    );
    await expect(ctx.replaceState({})).rejects.toThrow(
      'DurableContext.replaceState("lifecycle-contract") is not implemented in this build.',
    );
    await expect(ctx.getState()).rejects.toThrow(
      'DurableContext.getState("lifecycle-contract") is not implemented in this build.',
    );
    expect(() => ctx.info()).toThrow(
      'DurableContext.info("lifecycle-contract") is not implemented in this build.',
    );
  });

  it("shapes ContinuationSignal like the SuspensionSignal control signal", () => {
    const signal = new ContinuationSignal(
      { orderId: "o1" },
      { state: { n: 1 } },
    );

    expect(signal).toBeInstanceOf(Error);
    expect(signal).not.toBeInstanceOf(SuspensionSignal);
    expect(signal.name).toBe("ContinuationSignal");
    expect(signal.message).toBe("Execution continued as new");
    expect(signal.nextInput).toEqual({ orderId: "o1" });
    expect(signal.options).toEqual({ state: { n: 1 } });
    expect(new ContinuationSignal(null).options).toBeUndefined();
  });

  it("identifies pause/resume rejections", () => {
    try {
      durablePauseRejectedError.throw({
        executionId: "e1",
        status: "running",
      });
      throw new Error("expected durablePauseRejectedError.throw to throw");
    } catch (error) {
      expect(durablePauseRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot pause execution "e1" with status "running".',
      );
    }

    try {
      durableResumeRejectedError.throw({
        executionId: "e2",
        status: "running",
      });
      throw new Error("expected durableResumeRejectedError.throw to throw");
    } catch (error) {
      expect(durableResumeRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot resume execution "e2" with status "running": it is not paused.',
      );
    }
  });

  it("identifies restart/continue-as-new rejections", () => {
    try {
      durableRestartRejectedError.throw({
        executionId: "e3",
        status: "running",
      });
      throw new Error("expected durableRestartRejectedError.throw to throw");
    } catch (error) {
      expect(durableRestartRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot restart execution "e3" with status "running".',
      );
    }

    try {
      durableContinueAsNewRejectedError.throw({
        executionId: "e4",
        reason: "handlers still running",
      });
      throw new Error(
        "expected durableContinueAsNewRejectedError.throw to throw",
      );
    } catch (error) {
      expect(durableContinueAsNewRejectedError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Cannot continue execution "e4" as new: handlers still running.',
      );
    }
  });

  it("identifies store-capability and state errors", () => {
    expect(RunnerErrorId.DurableLifecycleUnsupportedStoreCapability).toBe(
      "durable-lifecycle-unsupportedStoreCapability",
    );

    try {
      durableLifecycleUnsupportedStoreCapabilityError.throw({
        operation: "continue-as-new",
      });
      throw new Error(
        "expected durableLifecycleUnsupportedStoreCapabilityError.throw to throw",
      );
    } catch (error) {
      expect(durableLifecycleUnsupportedStoreCapabilityError.is(error)).toBe(
        true,
      );
      expect(String(error)).toContain("Store does not support continue-as-new");
    }

    try {
      durableWorkflowStateInvalidError.throw({
        executionId: "e5",
        reason: "patch must be an object",
      });
      throw new Error(
        "expected durableWorkflowStateInvalidError.throw to throw",
      );
    } catch (error) {
      expect(durableWorkflowStateInvalidError.is(error)).toBe(true);
      expect(String(error)).toContain(
        'Invalid workflow state for execution "e5": patch must be an object.',
      );
    }
  });
});
