import { isLiveStatus } from "../../src/shared/statuses.js";
import type {
  StudioExecutionDetail,
  StudioExecutionStatus,
  StudioNodeState,
  StudioWorkflow,
} from "../../src/shared/types.js";

const SCALE_EXECUTION_COUNT = 1_000;
const SCALE_ACTIVE_EXECUTION_COUNT = 20;

const ACTIVE_STATUSES: StudioExecutionStatus[] = [
  "running",
  "sleeping",
  "pending",
  "retrying",
  "cancelling",
];

const FINISHED_STATUSES: StudioExecutionStatus[] = [
  "completed",
  "completed",
  "completed",
  "completed",
  "failed",
  "cancelled",
  "compensation_failed",
];

function positionForStatus(status: StudioExecutionStatus): string {
  if (status === "completed") return "Completed";
  if (status === "failed")
    return "Failed at `performWork`: provider rejected request";
  if (status === "compensation_failed")
    return "Compensation failed at `performWork`";
  if (status === "cancelled") return "Cancelled";
  if (status === "sleeping") return "Sleeping at `performWork`";
  if (status === "running") return "Running step `performWork`";
  if (status === "retrying") return "Retrying step `performWork`";
  if (status === "cancelling") return "Cancelling after `performWork`";
  return "Queued for execution";
}

function timestamp(nowMs: number, ageMs: number): string {
  return new Date(nowMs - ageMs).toISOString();
}

function nodeStateForStatus(
  status: StudioExecutionStatus,
  nodeIndex: number,
): StudioNodeState {
  if (nodeIndex === 0) return "completed";
  if (status === "failed" || status === "compensation_failed") {
    return nodeIndex === 1 ? "failed" : "unreached";
  }
  if (status === "cancelled") return "skipped";
  if (!isLiveStatus(status)) return "completed";
  if (nodeIndex > 1) return "pending";
  return status === "sleeping" ? "waiting" : "active";
}

function buildDetail({
  workflow,
  status,
  sequence,
  nowMs,
}: {
  workflow: StudioWorkflow;
  status: StudioExecutionStatus;
  sequence: number;
  nowMs: number;
}): StudioExecutionDetail {
  const live = isLiveStatus(status);
  const createdAgeMs = live
    ? (sequence + 1) * 1_000
    : 3_600_000 + sequence * 45_000;
  const createdAt = timestamp(nowMs, createdAgeMs);
  const completedAt = live ? null : timestamp(nowMs, createdAgeMs - 30_000);
  const failed = status === "failed" || status === "compensation_failed";
  const nodeCompletedAt = timestamp(nowMs, Math.max(0, createdAgeMs - 10_000));
  return {
    id: `scale_${workflow.key}_${String(sequence + 1).padStart(4, "0")}`,
    workflowKey: workflow.key,
    workflowTitle: workflow.title,
    status,
    attempt: status === "retrying" ? 2 : 1,
    maxAttempts: 3,
    input: {
      referenceId: `${workflow.key}-${sequence + 1}`,
      priority: "normal",
    },
    result: status === "completed" ? { accepted: true } : null,
    error: failed
      ? { message: "Provider rejected request", stepId: "performWork" }
      : null,
    createdAt,
    updatedAt: live ? timestamp(nowMs, sequence * 500) : completedAt!,
    completedAt,
    position: positionForStatus(status),
    timeline: workflow.graph.nodes.map((node, nodeIndex) => {
      const state = nodeStateForStatus(status, nodeIndex);
      return {
        ...node,
        state,
        branchTaken: null,
        result: state === "completed" ? { ok: true } : null,
        completedAt: state === "completed" ? nodeCompletedAt : null,
        wait: state === "waiting" ? { fireAtMs: nowMs + 120_000 } : null,
      };
    }),
    edges: workflow.graph.edges,
    steps: [],
    audit: [],
    signals: [],
    state: null,
    relations: { parent: null, children: [] },
  };
}

/** Builds the remaining runs so every workflow has 20 and the fleet has 20 live. */
export function buildScaleExecutionDetails(
  workflows: StudioWorkflow[],
  existing: StudioExecutionDetail[],
  nowMs = Date.now(),
): StudioExecutionDetail[] {
  const existingByWorkflow = new Map<string, number>();
  for (const detail of existing) {
    existingByWorkflow.set(
      detail.workflowKey,
      (existingByWorkflow.get(detail.workflowKey) ?? 0) + 1,
    );
  }
  const remainingByWorkflow = new Map(
    workflows.map((workflow) => {
      const remaining = 20 - (existingByWorkflow.get(workflow.key) ?? 0);
      if (remaining < 0) {
        throw new Error(
          `Workflow '${workflow.key}' already exceeds 20 demo runs.`,
        );
      }
      return [workflow.key, remaining] as const;
    }),
  );
  const slots: StudioWorkflow[] = [];
  for (let round = 0; round < 20; round += 1) {
    for (const workflow of workflows) {
      if (round < remainingByWorkflow.get(workflow.key)!) slots.push(workflow);
    }
  }
  const existingLive = existing.filter((detail) =>
    isLiveStatus(detail.status),
  ).length;
  const liveToAdd = SCALE_ACTIVE_EXECUTION_COUNT - existingLive;
  if (liveToAdd < 0) {
    throw new Error("Hand-authored fixtures already exceed 20 live demo runs.");
  }
  const details = slots.map((workflow, sequence) =>
    buildDetail({
      workflow,
      sequence,
      nowMs,
      status:
        sequence < liveToAdd
          ? ACTIVE_STATUSES[sequence % ACTIVE_STATUSES.length]!
          : FINISHED_STATUSES[
              (sequence - liveToAdd) % FINISHED_STATUSES.length
            ]!,
    }),
  );
  if (existing.length + details.length !== SCALE_EXECUTION_COUNT) {
    throw new Error("Scale demo execution total drifted from 1,000.");
  }
  return details;
}
