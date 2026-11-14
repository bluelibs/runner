import type { IDurableStore } from "../interfaces/store";
import { followContinuedExecutionChain } from "../continuedChain";
import {
  ExecutionStatus,
  TimerType,
  isExecutionTerminal,
  type Execution,
} from "../types";
import {
  parseExecutionWaitState,
  parseSignalState,
  parseSleepState,
} from "../utils";

/** Detects abandoned progress without repeatedly replaying healthy parked waits. */
export async function needsClusterRecovery(
  store: IDurableStore,
  execution: Execution,
): Promise<boolean> {
  if (
    isExecutionTerminal(execution.status) ||
    execution.status === ExecutionStatus.Paused
  )
    return false;
  if (execution.status === ExecutionStatus.Cancelling) return true;
  const timers = await store.getExecutionTimers!(execution.id);
  if (timers.some((timer) => timer.type === TimerType.Retry)) return false;
  if (execution.status !== ExecutionStatus.Sleeping) return true;
  const current = execution.current;
  if (!current) return true;
  const step = await store.getStepResult(execution.id, current.stepId);
  if (current.kind === "sleep") {
    if (parseSleepState(step?.result)?.state === "completed") return true;
    return !timers.some(
      (timer) =>
        timer.stepId === current.stepId && timer.type === TimerType.Sleep,
    );
  }
  if (current.kind === "waitForSignal") {
    const state = parseSignalState(step?.result);
    if (!state || state.state !== "waiting") return true;
    const signal = await store.getSignalState(
      execution.id,
      current.waitingFor.params.signalId,
    );
    if (signal && signal.queued.length > 0) return true;
    return (
      state.timeoutMs !== undefined &&
      !timers.some((timer) => timer.id === state.timerId)
    );
  }
  if (current.kind === "waitForExecution") {
    const state = parseExecutionWaitState(step?.result);
    if (!state || state.state !== "waiting") return true;
    const target = await store.getExecution(state.targetExecutionId);
    if (!target) return true;
    const tip = await followContinuedExecutionChain(store, target);
    if (isExecutionTerminal(tip.status)) return true;
    return (
      state.timeoutMs !== undefined &&
      !timers.some((timer) => timer.id === state.timerId)
    );
  }
  return true;
}
