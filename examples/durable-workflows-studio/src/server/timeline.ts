/**
 * Timeline projection: overlays durable runtime state on a workflow's static
 * graph so the studio can render where an execution is, what finished, which
 * branch was taken, and what each step produced.
 */
import type {
  DurableExecutionCurrent,
  Execution,
  StepResult,
} from "@bluelibs/runner/node";
import type {
  StudioGraphEdge,
  StudioNodeState,
  StudioTimelineNode,
  StudioWorkflow,
} from "../shared/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readState(result: unknown): string | null {
  if (!isRecord(result)) return null;
  return typeof result.state === "string" ? result.state : null;
}

function readBranchTaken(result: unknown): string | null {
  if (!isRecord(result)) return null;
  return typeof result.branchId === "string" ? result.branchId : null;
}

/**
 * Nodes reachable from the graph roots when already-evaluated switches only
 * follow their taken branch. Anything else without a result was skipped.
 */
export function computeReachableNodeIds(
  workflow: StudioWorkflow,
  branchTakenBySwitch: Map<string, string>,
): Set<string> {
  const incoming = new Map<string, number>();
  for (const node of workflow.graph.nodes) {
    incoming.set(node.id, 0);
  }
  const outgoing = new Map<string, StudioGraphEdge[]>();
  for (const edge of workflow.graph.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  const queue = workflow.graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (edge.branch !== undefined) {
        const taken = branchTakenBySwitch.get(edge.from);
        if (taken !== undefined && taken !== edge.branch) continue;
      }
      queue.push(edge.to);
    }
  }
  return reachable;
}

function waitMetadata(
  nodeId: string,
  result: unknown,
  current: DurableExecutionCurrent | undefined,
): StudioTimelineNode["wait"] {
  if (current?.stepId === nodeId && "waitingFor" in current) {
    const params = current.waitingFor.params as Record<string, unknown>;
    const wait: NonNullable<StudioTimelineNode["wait"]> = {};
    if (typeof params.signalId === "string") wait.signalId = params.signalId;
    if (typeof params.targetExecutionId === "string") {
      wait.targetExecutionId = params.targetExecutionId;
    }
    if (typeof params.timeoutAtMs === "number") {
      wait.timeoutAtMs = params.timeoutAtMs;
    }
    if (typeof params.fireAtMs === "number") wait.fireAtMs = params.fireAtMs;
    return wait;
  }
  if (isRecord(result)) {
    const wait: NonNullable<StudioTimelineNode["wait"]> = {};
    if (typeof result.signalId === "string") wait.signalId = result.signalId;
    if (typeof result.targetExecutionId === "string") {
      wait.targetExecutionId = result.targetExecutionId;
    }
    if (typeof result.timeoutAtMs === "number") {
      wait.timeoutAtMs = result.timeoutAtMs;
    }
    if (typeof result.fireAtMs === "number") wait.fireAtMs = result.fireAtMs;
    return Object.keys(wait).length > 0 ? wait : null;
  }
  return null;
}

function stateForCurrent(
  current: DurableExecutionCurrent,
): StudioNodeState {
  switch (current.kind) {
    case "step":
    case "switch":
      return "active";
    case "sleep":
    case "waitForSignal":
    case "waitForExecution":
      return "waiting";
  }
}

export function isTerminalStatus(status: Execution["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "compensation_failed"
  );
}

/**
 * Projects one graph node to its runtime overlay. `failedNodeId` pinpoints
 * where a failed attempt stopped; `firstActiveId` marks where a running
 * attempt sits when no live pointer survives.
 */
function projectNode(
  workflow: StudioWorkflow,
  nodeId: string,
  execution: Execution,
  stepsById: Map<string, StepResult>,
  branchTakenBySwitch: Map<string, string>,
  reachable: Set<string>,
  failedNodeId: string | null,
  firstActiveId: string | null,
): StudioTimelineNode {
  const node = workflow.graph.nodes.find((n) => n.id === nodeId)!;
  const step = stepsById.get(nodeId);
  const current = execution.current;
  const isCurrent = current?.stepId === nodeId;
  const persistedState = step ? readState(step.result) : null;
  const terminal = isTerminalStatus(execution.status);

  // Without a live pointer, a running attempt sits at the result gap.
  const gapActive =
    !terminal &&
    current === undefined &&
    execution.status === "running" &&
    nodeId === firstActiveId;

  let state: StudioNodeState;
  if (nodeId === failedNodeId) {
    state = "failed";
  } else if (persistedState === "waiting" || persistedState === "sleeping") {
    // Live waits park here; markers left behind by terminal executions did not.
    state = terminal ? "unreached" : "waiting";
  } else if (step) {
    state = "completed";
  } else if (!reachable.has(nodeId)) {
    state = "skipped";
  } else if (terminal) {
    state = execution.status === "completed" ? "skipped" : "unreached";
  } else if (isCurrent && current !== undefined) {
    state = stateForCurrent(current);
  } else if (gapActive) {
    state = "active";
  } else {
    state = "pending";
  }

  return {
    ...node,
    state,
    branchTaken: branchTakenBySwitch.get(nodeId) ?? null,
    result: step?.result ?? null,
    completedAt: step ? step.completedAt.toISOString() : null,
    wait: waitMetadata(nodeId, step?.result, current),
  };
}

/** Persisted steps with no catalog entry surface as extra completed nodes. */
function extraNodes(
  workflow: StudioWorkflow,
  steps: StepResult[],
): StudioTimelineNode[] {
  const known = new Set(workflow.graph.nodes.map((node) => node.id));
  return steps
    .filter((step) => !known.has(step.stepId))
    .map((step) => ({
      id: step.stepId,
      kind: step.stepId.startsWith("__signal:")
        ? ("signal" as const)
        : step.stepId.startsWith("__sleep:")
          ? ("sleep" as const)
          : step.stepId.startsWith("__note:")
            ? ("note" as const)
            : ("step" as const),
      label: step.stepId,
      description: "Persisted step with no catalog entry.",
      state: "completed" as const,
      branchTaken: readBranchTaken(step.result),
      result: step.result,
      completedAt: step.completedAt.toISOString(),
      wait: null,
    }));
}

/**
 * First graph node (in catalog order) without a persisted result. Steps run
 * in order and results are append-only, so the gap is where a live attempt
 * sits or where a failed attempt stopped.
 */
function firstGapId(
  workflow: StudioWorkflow,
  stepsById: Map<string, StepResult>,
): string | undefined {
  return workflow.graph.nodes.find((node) => !stepsById.has(node.id))?.id;
}

/**
 * Short human line describing where the execution currently sits, used in
 * list rows and the detail header.
 *
 * Reads the persisted position pointer and failed step attribution first, then
 * falls back to wait markers and the result gap for older stored executions.
 */
export function describePosition(
  execution: Execution,
  steps: StepResult[],
  workflow?: StudioWorkflow,
): string | null {
  const current = execution.current;
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));
  if (execution.status === "failed") {
    const gap =
      execution.error?.stepId ??
      current?.stepId ??
      (workflow ? firstGapId(workflow, stepsById) : undefined);
    const where = gap ? ` at \`${gap}\`` : "";
    return execution.error
      ? `Failed${where}: ${execution.error.message}`
      : `Failed${where}`;
  }
  if (execution.status === "completed") return "Completed";
  if (execution.status === "cancelled") return "Cancelled";
  if (execution.status === "compensation_failed") return "Compensation failed";
  if (current) {
    switch (current.kind) {
      case "step":
        return `Running step \`${current.stepId}\``;
      case "switch":
        return `Evaluating branch \`${current.stepId}\``;
      case "sleep":
        return `Sleeping at \`${current.stepId}\``;
      case "waitForSignal":
        return `Waiting for signal \`${current.waitingFor.params.signalId}\``;
      case "waitForExecution":
        return `Waiting for execution \`${current.waitingFor.params.targetExecutionId}\``;
    }
  }
  const orderedIds = workflow
    ? workflow.graph.nodes.map((node) => node.id)
    : steps.map((step) => step.stepId);
  for (const stepId of orderedIds) {
    const marker = stepsById.get(stepId);
    const markerState = marker ? readState(marker.result) : null;
    if (markerState === "waiting") {
      const result = marker?.result;
      const signalId =
        isRecord(result) && typeof result.signalId === "string"
          ? result.signalId
          : "unknown";
      return `Waiting for signal \`${signalId}\``;
    }
    if (markerState === "sleeping") {
      return `Sleeping at \`${stepId}\``;
    }
  }
  if (execution.status === "retrying") return "Retrying";
  if (execution.status === "cancelling") return "Cancelling";
  if (execution.status === "running" && workflow) {
    const gapId = firstGapId(workflow, stepsById);
    const gap = workflow.graph.nodes.find((node) => node.id === gapId);
    if (gap?.kind === "switch") return `Evaluating branch \`${gap.id}\``;
    if (gap) return `Running step \`${gap.id}\``;
    return "Completing";
  }
  return null;
}

/**
 * Pinpoints the failed node from explicit error attribution, then the persisted
 * position, with the result gap retained for older execution records.
 */
function findFailedNodeId(
  workflow: StudioWorkflow,
  execution: Execution,
  stepsById: Map<string, StepResult>,
): string | undefined {
  const currentStepId = execution.error?.stepId ?? execution.current?.stepId;
  if (
    currentStepId !== undefined &&
    workflow.graph.nodes.some((node) => node.id === currentStepId)
  ) {
    return currentStepId;
  }
  return firstGapId(workflow, stepsById);
}

export function projectTimeline(
  workflow: StudioWorkflow,
  execution: Execution,
  steps: StepResult[],
): StudioTimelineNode[] {
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));
  const branchTakenBySwitch = new Map<string, string>();
  for (const node of workflow.graph.nodes) {
    if (node.kind !== "switch") continue;
    const step = stepsById.get(node.id);
    const branch = step ? readBranchTaken(step.result) : null;
    if (branch) branchTakenBySwitch.set(node.id, branch);
  }
  const reachable = computeReachableNodeIds(workflow, branchTakenBySwitch);

  const failedNodeId =
    execution.status === "failed"
      ? (findFailedNodeId(workflow, execution, stepsById) ?? null)
      : null;
  const firstActiveId = firstGapId(workflow, stepsById) ?? null;

  return [
    ...workflow.graph.nodes.map((node) =>
      projectNode(
        workflow,
        node.id,
        execution,
        stepsById,
        branchTakenBySwitch,
        reachable,
        failedNodeId,
        firstActiveId,
      ),
    ),
    ...extraNodes(workflow, steps),
  ];
}
