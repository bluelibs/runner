/**
 * Presentation metadata for statuses and node states.
 *
 * Kept framework-free so the web client renders the exact same labels and
 * tones the server assumes in tests.
 */
import type {
  StudioExecutionStatus,
  StudioNodeKind,
  StudioNodeState,
} from "./types.js";

/** UI tone driving pill/dot colours in the Linear-style theme. */
export type StudioTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export const EXECUTION_STATUS_META: Record<
  StudioExecutionStatus,
  { label: string; tone: StudioTone; terminal: boolean }
> = {
  pending: { label: "Pending", tone: "neutral", terminal: false },
  running: { label: "Running", tone: "info", terminal: false },
  cancelling: { label: "Cancelling", tone: "warning", terminal: false },
  retrying: { label: "Retrying", tone: "warning", terminal: false },
  sleeping: { label: "Sleeping", tone: "accent", terminal: false },
  paused: { label: "Paused", tone: "warning", terminal: false },
  completed: { label: "Completed", tone: "success", terminal: true },
  compensation_failed: {
    label: "Compensation failed",
    tone: "danger",
    terminal: true,
  },
  failed: { label: "Failed", tone: "danger", terminal: true },
  cancelled: { label: "Cancelled", tone: "neutral", terminal: true },
  continued_as_new: {
    label: "Continued as new",
    tone: "neutral",
    terminal: true,
  },
};

export const NODE_STATE_META: Record<
  StudioNodeState,
  { label: string; tone: StudioTone }
> = {
  completed: { label: "Completed", tone: "success" },
  active: { label: "Running", tone: "info" },
  waiting: { label: "Waiting", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
  pending: { label: "Pending", tone: "neutral" },
  unreached: { label: "Not reached", tone: "neutral" },
};

export const NODE_KIND_META: Record<StudioNodeKind, { label: string }> = {
  step: { label: "Step" },
  sleep: { label: "Sleep" },
  signal: { label: "Signal" },
  switch: { label: "Branch" },
  child: { label: "Child workflow" },
  note: { label: "Note" },
};

/** True when the status is a live, non-terminal execution state. */
export function isLiveStatus(status: StudioExecutionStatus): boolean {
  return !EXECUTION_STATUS_META[status].terminal;
}

/** True when the node still needs operator attention or time to proceed. */
export function isAttentionState(state: StudioNodeState): boolean {
  return state === "active" || state === "waiting" || state === "failed";
}
