import type { Timer } from "./types";
import type { IDurableStore } from "./interfaces/store";

/** A pending FIFO needs one recurring redrive until its final receipt commits. */
export const commandWakeupDelayMs = 1000;

/** Test adapters may advance workflow time independently from ownership leases. */
export function nextCommandWakeup(store: IDurableStore): Date {
  return new Date(
    (store.getWorkflowTime?.() ?? Date.now()) + commandWakeupDelayMs,
  );
}

/** Exact execution identity keeps command wakeups independent of workflow addressing. */
export function commandWakeupId(executionId: string): string {
  return `commands:${JSON.stringify(executionId)}`;
}

/** One persistent redrive is shared by every pending request on this execution. */
export function commandWakeupTimer(executionId: string, fireAt: Date): Timer {
  return {
    id: commandWakeupId(executionId),
    executionId,
    type: "retry",
    commandWakeup: true,
    status: "pending",
    fireAt: new Date(fireAt.getTime()),
  };
}
