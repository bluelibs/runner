import type { IDurableStore } from "../interfaces/store";
import type { IEventBus } from "../interfaces/bus";
import type {
  DurableServiceConfig,
  ITaskExecutor,
} from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import { ExecutionStatus, type Execution } from "../types";
import { DurableContext } from "../DurableContext";
import { SuspensionSignal } from "../interfaces/context";
import { getDeclaredDurableWorkflowSignalIds } from "../../tags/durableWorkflow.tag";
import { isTimeoutExceededError, withTimeout } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import type { ExecutionCancellationState } from "./ExecutionManager.cancellation";

export type ExecutionAttemptGuards = {
  assertLockOwnership: () => void;
  raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
  canPersistOutcome: () => Promise<boolean>;
  getCancellationState: () => Promise<ExecutionCancellationState | null>;
};

export type ExecutionErrorInfo = {
  message: string;
  stack?: string;
};

export type TaskAttemptOutcome =
  | { kind: "completed"; result: unknown }
  | { kind: "already-finalized" };

export function toExecutionErrorInfo(error: unknown): ExecutionErrorInfo {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

export function isCompensationFailure(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Compensation failed")
  );
}

export function createExecutionAttemptGuards(params: {
  executionId: string;
  lockState: ExecutionLockState;
  store: IDurableStore;
  assertStoreLockOwnership: (lockState: ExecutionLockState) => Promise<void>;
  getCancellationState: (
    execution: Execution<unknown, unknown> | null,
  ) => ExecutionCancellationState | null;
}): ExecutionAttemptGuards {
  const assertLockOwnership = (): void => {
    if (params.lockState.lost) {
      durableExecutionInvariantError.throw({
        message: `Execution lock lost for '${params.executionId}' while the attempt was still running.`,
      });
    }
  };

  return {
    assertLockOwnership,
    raceWithLockLoss: async <T>(promise: Promise<T>): Promise<T> =>
      await Promise.race([promise, params.lockState.waitForLoss]),
    canPersistOutcome: async (): Promise<boolean> => {
      try {
        assertLockOwnership();
        await params.assertStoreLockOwnership(params.lockState);
        return true;
      } catch (error) {
        if (error === params.lockState.lossError || params.lockState.lost) {
          return false;
        }
        throw error;
      }
    },
    getCancellationState:
      async (): Promise<ExecutionCancellationState | null> =>
        params.getCancellationState(
          await params.store.getExecution(params.executionId),
        ),
  };
}

export function createExecutionContext(params: {
  store: IDurableStore;
  eventBus: IEventBus;
  execution: Execution<unknown, unknown>;
  task: ITask<unknown, Promise<unknown>, any, any, any, any>;
  assertLockOwnership: () => void;
  cancellationSignal: AbortSignal;
  auditConfig?: DurableServiceConfig["audit"];
  determinismConfig?: DurableServiceConfig["determinism"];
  startExecution: (
    task: ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options?: { parentExecutionId?: string },
  ) => Promise<string>;
  getTaskWorkflowKey: (
    task: ITask<any, Promise<any>, any, any, any, any>,
  ) => string;
}): DurableContext {
  return new DurableContext(
    params.store,
    params.eventBus,
    params.execution.id,
    params.execution.attempt,
    {
      auditEnabled: params.auditConfig?.enabled === true,
      auditEmitter: params.auditConfig?.emitter,
      implicitInternalStepIds:
        params.determinismConfig?.implicitInternalStepIds,
      declaredSignalIds: getDeclaredDurableWorkflowSignalIds(params.task),
      assertLockOwnership: params.assertLockOwnership,
      cancellationSignal: params.cancellationSignal,
      startWorkflowExecution: async (childTask, input, options) =>
        await params.startExecution(childTask, input, options),
      getTaskPersistenceId: (childTask) => params.getTaskWorkflowKey(childTask),
    },
  );
}

export async function runTaskAttempt(params: {
  task: ITask<unknown, Promise<unknown>, any, any, any, any>;
  input: unknown;
  context: DurableContext;
  execution: Execution<unknown, unknown>;
  taskExecutor: ITaskExecutor;
  contextProvider: DurableServiceConfig["contextProvider"];
  raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
  canPersistOutcome: () => Promise<boolean>;
  transitionToFailed: (p: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus;
    reason: "timed_out";
    error: { message: string };
  }) => Promise<void>;
}): Promise<TaskAttemptOutcome> {
  const contextProvider =
    params.contextProvider ??
    ((_ctx: DurableContext, fn: () => unknown) => fn());
  const taskPromise = Promise.resolve(
    contextProvider(params.context, () =>
      params.taskExecutor.run(params.task, params.input),
    ),
  );

  if (!params.execution.timeout) {
    return {
      kind: "completed",
      result: await params.raceWithLockLoss(taskPromise),
    };
  }

  const timeoutMessage = `Execution ${params.execution.id} timed out`;
  const elapsed = Date.now() - params.execution.createdAt.getTime();
  const remainingTimeout = Math.max(0, params.execution.timeout - elapsed);

  if (remainingTimeout === 0 && params.execution.timeout > 0) {
    if (!(await params.canPersistOutcome())) {
      return { kind: "already-finalized" };
    }
    await params.transitionToFailed({
      execution: params.execution,
      from: ExecutionStatus.Running,
      reason: "timed_out",
      error: { message: timeoutMessage },
    });
    return { kind: "already-finalized" };
  }

  return {
    kind: "completed",
    result: await params.raceWithLockLoss(
      withTimeout(taskPromise, remainingTimeout, timeoutMessage),
    ),
  };
}

export async function handleExecutionAttemptError(params: {
  error: unknown;
  runningExecution: Execution<unknown, unknown>;
  guards: ExecutionAttemptGuards;
  executionLockState: ExecutionLockState;
  transitionToCancelled: (p: {
    execution: Execution<unknown, unknown>;
    reason: string;
    canPersistOutcome?: () => Promise<boolean>;
  }) => Promise<void>;
  transitionToFailed: (p: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus;
    reason: "failed" | "timed_out";
    error: ExecutionErrorInfo;
  }) => Promise<void>;
  suspendAttempt: (
    execution: Execution<unknown, unknown>,
    reason: string,
    canPersistOutcome?: () => Promise<boolean>,
  ) => Promise<void>;
  scheduleRetry: (p: {
    runningExecution: Execution<unknown, unknown>;
    error: ExecutionErrorInfo;
    canPersistOutcome?: () => Promise<boolean>;
  }) => Promise<void>;
}): Promise<void> {
  if (
    params.error === params.executionLockState.lossError ||
    params.executionLockState.lost
  ) {
    return;
  }

  const cancellationState = await params.guards.getCancellationState();

  if (params.error instanceof SuspensionSignal) {
    if (cancellationState) {
      await params.transitionToCancelled({
        execution: params.runningExecution,
        reason: cancellationState.reason,
        canPersistOutcome: params.guards.canPersistOutcome,
      });
      return;
    }
    await params.suspendAttempt(
      params.runningExecution,
      params.error.reason,
      params.guards.canPersistOutcome,
    );
    return;
  }

  if (isCompensationFailure(params.error)) {
    return;
  }

  if (cancellationState) {
    await params.transitionToCancelled({
      execution: params.runningExecution,
      reason: cancellationState.reason,
      canPersistOutcome: params.guards.canPersistOutcome,
    });
    return;
  }

  const errorInfo = toExecutionErrorInfo(params.error);
  const timedOut = isTimeoutExceededError(params.error);
  const exhaustedAttempts =
    params.runningExecution.attempt >= params.runningExecution.maxAttempts;

  if (timedOut || exhaustedAttempts) {
    if (!(await params.guards.canPersistOutcome())) {
      return;
    }
    await params.transitionToFailed({
      execution: params.runningExecution,
      from: ExecutionStatus.Running,
      reason: timedOut ? "timed_out" : "failed",
      error: errorInfo,
    });
    return;
  }

  await params.scheduleRetry({
    runningExecution: params.runningExecution,
    error: errorInfo,
    canPersistOutcome: params.guards.canPersistOutcome,
  });
}
