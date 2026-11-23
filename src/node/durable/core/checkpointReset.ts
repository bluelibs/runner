import type { IDurableStore } from "./interfaces/store";
import type {
  DurableReplayFixture,
  DurableResetOptions,
  DurableCheckpointBranch,
} from "./interfaces/history";
import { isExecutionTerminal } from "./types";
import { durableExecutionInvariantError } from "../../../errors";
import { check, Match } from "../../../tools/check";
import { createExecutionId } from "./utils";
import { withCheckpointLease } from "./checkpointLease";

/** Captures a consistent prefix while the caller owns the execution lease. */
export async function exportReplay(
  store: IDurableStore,
  executionId: string,
): Promise<DurableReplayFixture> {
  const execution = await store.getExecution(executionId);
  if (!execution?.historyRecorded || !store.listExecutionHistory)
    return durableExecutionInvariantError.throw({
      message:
        "Execution has no recorded replay history; legacy or collected runs cannot be reconstructed.",
    });
  const history = await store.listExecutionHistory(executionId);
  if (!history.some((entry) => entry.kind === "origin"))
    return durableExecutionInvariantError.throw({
      message: "Execution has no recorded origin checkpoint.",
    });
  return {
    execution,
    history,
    steps: await store.listStepResults(executionId),
  };
}

/** Rejects ambiguous cuts through parallel or nested work rather than guessing a prefix. */
export function prepareCheckpointBranch(
  fixture: DurableReplayFixture,
  id: string,
  options: DurableResetOptions,
): DurableCheckpointBranch {
  const source = fixture.execution;
  if (source.status !== "paused" && !isExecutionTerminal(source.status))
    return durableExecutionInvariantError.throw({
      message: "Pause the source execution before resetting a live workflow.",
    });
  const boundary = fixture.history.find(
    (entry) => entry.stepId === options.beforeStep,
  );
  if (
    !boundary ||
    boundary.parentStepId ||
    boundary.kind === "origin" ||
    boundary.kind === "command"
  )
    return durableExecutionInvariantError.throw({
      message: "Reset requires an existing top-level workflow operation.",
    });
  const prefix = fixture.history.filter(
    (entry) => entry.startedOrder < boundary.startedOrder,
  );
  if (
    prefix.some(
      (entry) =>
        entry.completedOrder === undefined ||
        entry.completedOrder >= boundary.startedOrder,
    )
  )
    return durableExecutionInvariantError.throw({
      message: "Reset cannot cut across overlapping or unfinished operations.",
    });
  const ids = new Set(prefix.map((entry) => entry.stepId));
  const snapshots = prefix
    .filter((entry) => entry.stateAfter !== undefined)
    .sort((a, b) => a.completedOrder! - b.completedOrder!);
  const state = snapshots[snapshots.length - 1]?.stateAfter ?? null;
  const now = new Date();
  return {
    expected: source,
    execution: {
      id,
      workflowKey: source.workflowKey,
      ...(source.workflowVersion === undefined
        ? {}
        : { workflowVersion: source.workflowVersion }),
      input: source.input,
      ...(source.retention ? { retention: source.retention } : {}),
      status: "pending",
      attempt: 1,
      maxAttempts: source.maxAttempts,
      timeout: source.timeout,
      createdAt: now,
      updatedAt: now,
      historyRecorded: true,
      resetFromExecutionId: source.id,
      resetBeforeStep: options.beforeStep,
      resetReason: options.reason,
    },
    history: prefix,
    state,
    steps: fixture.steps
      .filter((step) => ids.has(step.stepId))
      .map((step) => ({ ...step, executionId: id })),
  };
}

/** Resets are branches: source records and original checkpoints remain untouched. */
export async function resetCheckpoint(
  store: IDurableStore,
  sourceId: string,
  options: DurableResetOptions,
): Promise<string> {
  check(options, {
    beforeStep: Match.NonEmptyString,
    reason: Match.NonEmptyString,
    idempotencyKey: Match.Optional(Match.NonEmptyString),
  });
  if (!store.createCheckpointExecution)
    return durableExecutionInvariantError.throw({
      message:
        "Reset requires atomic checkpoint branching and renewable ownership support.",
    });
  const id =
    options.idempotencyKey === undefined
      ? createExecutionId()
      : `reset:${JSON.stringify([sourceId, options.beforeStep, options.idempotencyKey])}`;
  if (await store.getExecution(id)) return id;
  return withCheckpointLease(store, sourceId, async (owned) => {
    const branch = prepareCheckpointBranch(
      await exportReplay(owned, sourceId),
      id,
      options,
    );
    if (
      !(await owned.createCheckpointExecution!(branch)) &&
      !(await store.getExecution(id))
    )
      return durableExecutionInvariantError.throw({
        message:
          "Source changed while preparing reset; retry against its current state.",
      });
    return id;
  });
}
