import type { DurableCommandRecord } from "../../core/interfaces/commands";
import type { Execution } from "../../core/types";
import { isExecutionTerminal } from "../../core/types";
import { durableExecutionInvariantError } from "../../../../errors";
import type { MemoryStoreRuntime } from "./runtime";
import { updateHistory } from "./history";
import { isDeepStrictEqual } from "node:util";
import { check, Match } from "../../../../tools/check";
import { commandWakeupId, commandWakeupTimer } from "../../core/commandWakeup";

/** Reconciliation shares the FIFO mutation so a new admission cannot lose its wakeup. */
export async function rescheduleCommandTimer(
  runtime: MemoryStoreRuntime,
  executionId: string,
  fireAt: Date,
): Promise<boolean> {
  return runtime.withExecutionWaiterMutation(() => {
    const timer = commandWakeupTimer(executionId, fireAt);
    if (!runtime.commandQueues.get(executionId)?.length)
      return { result: false, changed: runtime.timers.delete(timer.id) };
    runtime.timers.set(timer.id, timer);
    return { result: true, changed: true };
  });
}

export async function enqueueCommand(
  runtime: MemoryStoreRuntime,
  command: DurableCommandRecord,
  fireAt: Date,
): Promise<DurableCommandRecord> {
  return runtime.withExecutionWaiterMutation(() => {
    const existing = runtime.commands.get(command.id);
    if (existing) return { result: structuredClone(existing), changed: false };
    const execution = runtime.executions.get(command.executionId);
    if (
      !execution ||
      isExecutionTerminal(execution.status) ||
      execution.status === "cancelling" ||
      execution.workflowVersion !== command.workflowVersion
    )
      return durableExecutionInvariantError.throw({
        message:
          "Commands require a live execution with the accepted workflow version.",
      });
    runtime.commands.set(command.id, structuredClone(command));
    const queue = runtime.commandQueues.get(command.executionId) ?? [];
    queue.push(command.id);
    runtime.commandQueues.set(command.executionId, queue);
    const timer = commandWakeupTimer(command.executionId, fireAt);
    if (!runtime.timers.has(timer.id)) runtime.timers.set(timer.id, timer);
    return { result: structuredClone(command), changed: true };
  });
}

export function nextCommand(
  runtime: MemoryStoreRuntime,
  id: string,
): DurableCommandRecord | null {
  const next = runtime.commandQueues.get(id)?.[0];
  return next === undefined
    ? null
    : structuredClone(runtime.commands.get(next)!);
}

export async function saveCommand(
  runtime: MemoryStoreRuntime,
  command: DurableCommandRecord,
): Promise<boolean> {
  check(command.status, Match.OneOf("pending", "running"));
  return runtime.withExecutionWaiterMutation(() => {
    const saved = runtime.commands.get(command.id);
    if (
      !saved ||
      (saved.status !== "pending" && saved.status !== "running") ||
      runtime.commandQueues.get(command.executionId)?.[0] !== command.id
    )
      return { result: false, changed: false };
    runtime.commands.set(command.id, structuredClone(command));
    return { result: true, changed: true };
  });
}

export async function completeCommand(
  runtime: MemoryStoreRuntime,
  command: DurableCommandRecord,
  expected?: Execution,
): Promise<boolean> {
  check(command.status, Match.OneOf("completed", "failed"));
  return runtime.withExecutionWaiterMutation(() => {
    const saved = runtime.commands.get(command.id);
    const queue = runtime.commandQueues.get(command.executionId);
    if (
      !saved ||
      (saved.status !== "pending" && saved.status !== "running") ||
      queue?.[0] !== command.id
    )
      return { result: false, changed: false };
    const target = runtime.executions.get(command.executionId);
    if (
      command.status === "completed" &&
      (!expected ||
        !target ||
        isExecutionTerminal(target.status) ||
        target.status === "paused" ||
        target.status === "cancelling" ||
        !isDeepStrictEqual(target, expected))
    )
      return { result: false, changed: false };
    if (command.status === "completed" && command.state !== undefined) {
      if (command.state)
        runtime.workflowStates.set(command.executionId, {
          executionId: command.executionId,
          state: structuredClone(command.state.value),
          updatedAt: command.completedAt!,
        });
      else runtime.workflowStates.delete(command.executionId);
      if (target?.historyRecorded)
        updateHistory(runtime, command.executionId, {
          kind: "command",
          stepId: `__command:${command.id}`,
          phase: "completed",
          stateAfter: structuredClone(command.state ?? null),
        });
    }
    runtime.commands.set(
      command.id,
      structuredClone({ ...command, state: undefined }),
    );
    queue.shift();
    if (queue.length === 0) {
      runtime.commandQueues.delete(command.executionId);
      runtime.timers.delete(commandWakeupId(command.executionId));
    }
    return { result: true, changed: true };
  });
}
