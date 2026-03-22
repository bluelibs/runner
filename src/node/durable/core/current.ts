import type { IDurableStore } from "./interfaces/store";
import type {
  DurableExecutionCurrent,
  DurableExecutionCurrentWorkflowMeta,
  DurableExecutionCurrentStep,
  ExecutionStatus,
} from "./types";

function isTerminalExecutionStatus(status: ExecutionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "compensation_failed" ||
    status === "cancelled"
  );
}

export function createStepCurrent(params: {
  stepId: string;
  startedAt: Date;
}): DurableExecutionCurrentStep {
  return {
    kind: "step",
    stepId: params.stepId,
    startedAt: params.startedAt,
  };
}

export function createWorkflowStepCurrent(params: {
  stepId: string;
  startedAt: Date;
  meta: DurableExecutionCurrentWorkflowMeta;
}): DurableExecutionCurrentStep {
  return {
    kind: "step",
    stepId: params.stepId,
    startedAt: params.startedAt,
    meta: params.meta,
  };
}

export function createSwitchCurrent(params: {
  stepId: string;
  startedAt: Date;
}): DurableExecutionCurrent {
  return {
    kind: "switch",
    stepId: params.stepId,
    startedAt: params.startedAt,
  };
}

export function createSleepCurrent(params: {
  stepId: string;
  durationMs?: number;
  fireAtMs: number;
  timerId: string;
  startedAt: Date;
}): DurableExecutionCurrent {
  return {
    kind: "sleep",
    stepId: params.stepId,
    startedAt: params.startedAt,
    waitingFor: {
      type: "sleep",
      params: {
        durationMs: params.durationMs,
        fireAtMs: params.fireAtMs,
        timerId: params.timerId,
      },
    },
  };
}

export function createSignalWaitCurrent(params: {
  stepId: string;
  signalId: string;
  timeoutMs?: number;
  timeoutAtMs?: number;
  timerId?: string;
  startedAt: Date;
}): DurableExecutionCurrent {
  return {
    kind: "waitForSignal",
    stepId: params.stepId,
    startedAt: params.startedAt,
    waitingFor: {
      type: "signal",
      params: {
        signalId: params.signalId,
        timeoutMs: params.timeoutMs,
        timeoutAtMs: params.timeoutAtMs,
        timerId: params.timerId,
      },
    },
  };
}

export function createExecutionWaitCurrent(params: {
  stepId: string;
  targetExecutionId: string;
  targetTaskId: string;
  timeoutMs?: number;
  timeoutAtMs?: number;
  timerId?: string;
  startedAt: Date;
}): DurableExecutionCurrent {
  return {
    kind: "waitForExecution",
    stepId: params.stepId,
    startedAt: params.startedAt,
    waitingFor: {
      type: "execution",
      params: {
        targetExecutionId: params.targetExecutionId,
        targetTaskId: params.targetTaskId,
        timeoutMs: params.timeoutMs,
        timeoutAtMs: params.timeoutAtMs,
        timerId: params.timerId,
      },
    },
  };
}

export async function setExecutionCurrent(
  store: IDurableStore,
  executionId: string,
  current: DurableExecutionCurrent,
): Promise<void> {
  const execution = await store.getExecution(executionId);
  if (!execution || isTerminalExecutionStatus(execution.status)) {
    return;
  }

  await store.saveExecutionIfStatus(
    {
      ...execution,
      current,
      updatedAt: new Date(),
    },
    [execution.status],
  );
}

export async function clearExecutionCurrent(
  store: IDurableStore,
  executionId: string,
): Promise<void> {
  const execution = await store.getExecution(executionId);
  if (
    !execution ||
    execution.current === undefined ||
    isTerminalExecutionStatus(execution.status)
  ) {
    return;
  }

  await store.saveExecutionIfStatus(
    {
      ...execution,
      current: undefined,
      updatedAt: new Date(),
    },
    [execution.status],
  );
}

/**
 * Clears `execution.current` only while the execution is still suspended on the
 * same durable wait slot. This keeps timer/signal cleanup from wiping a newer
 * active position after another worker has already resumed the execution.
 */
export async function clearExecutionCurrentIfSuspendedOnStep(
  store: IDurableStore,
  executionId: string,
  params: {
    stepId: string;
    kinds: DurableExecutionCurrent["kind"][];
  },
): Promise<void> {
  const execution = await store.getExecution(executionId);
  if (
    !execution ||
    execution.status !== "sleeping" ||
    execution.current === undefined ||
    execution.current.stepId !== params.stepId ||
    !params.kinds.includes(execution.current.kind)
  ) {
    return;
  }

  await store.saveExecutionIfStatus(
    {
      ...execution,
      current: undefined,
      updatedAt: new Date(),
    },
    ["sleeping"],
  );
}
