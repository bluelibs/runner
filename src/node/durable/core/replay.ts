import type { AnyTask } from "../../../types/task";
import type {
  DurableReplayFixture,
  DurableReplayReport,
} from "./interfaces/history";
import type { DurableServiceConfig } from "./interfaces/service";
import type { DurableReplayObserver } from "./durable-context/operationJournal";
import { DurableContext } from "./DurableContext";
import { MemoryStore } from "../store/MemoryStore";
import { NoopEventBus } from "../bus/NoopEventBus";
import { durableExecutionInvariantError } from "../../../errors";
import { getDeclaredDurableWorkflowSignalIds } from "../tags/durableWorkflow.tag";

/** Runs proposed orchestration against copied checkpoints without invoking effect callbacks. */
export async function replayWorkflow(
  task: AnyTask,
  fixture: DurableReplayFixture,
  config: Pick<
    DurableServiceConfig,
    | "taskExecutor"
    | "contextProvider"
    | "workflowKeyResolver"
    | "taskKeyResolver"
  >,
): Promise<DurableReplayReport> {
  if (!config.taskExecutor)
    return durableExecutionInvariantError.throw({
      message: "Replay requires a task executor.",
    });
  const issues: string[] = [];
  const history = fixture.history.filter(
    (entry) => entry.kind !== "origin" && entry.kind !== "command",
  );
  let matched = 0;
  const boundary = Symbol("replay boundary");
  const seen = new Set<string>();
  const observer: DurableReplayObserver = {
    before(operation) {
      const next = history.find((entry) => !seen.has(entry.stepId));
      if (!next) throw boundary;
      if (
        next.stepId !== operation.stepId ||
        next.kind !== operation.kind ||
        next.taskKey !== operation.taskKey
      ) {
        issues.push(
          `Expected ${next.kind} '${next.stepId}', received ${operation.kind} '${operation.stepId}'.`,
        );
        throw boundary;
      }
      seen.add(next.stepId);
      matched++;
      if (next.completedOrder === undefined) throw boundary;
    },
    after(stepId) {
      // A cached callback also skips its saved nested operations.
      const parents = new Set([stepId]);
      for (const entry of history)
        if (entry.parentStepId && parents.has(entry.parentStepId)) {
          parents.add(entry.stepId);
          seen.add(entry.stepId);
        }
    },
    effect() {
      issues.push(
        "Completed operation has no reusable result; replay stopped before its effect.",
      );
      throw boundary;
    },
  };
  if (
    !fixture.execution.historyRecorded ||
    !fixture.history.some((entry) => entry.kind === "origin")
  )
    return {
      compatible: false,
      matched: 0,
      issues: ["This execution has no complete recorded history."],
    };
  const store = new MemoryStore();
  await store.saveExecution({
    ...structuredClone(fixture.execution),
    status: "running",
    cancelRequestedAt: undefined,
  });
  for (const step of fixture.steps)
    await store.saveStepResult(structuredClone(step));
  const origin = fixture.history.find((entry) => entry.kind === "origin")!;
  if (origin.stateAfter)
    await store.saveWorkflowState({
      executionId: fixture.execution.id,
      state: origin.stateAfter.value,
      updatedAt: new Date(),
    });
  const context = new DurableContext(
    store,
    new NoopEventBus(),
    fixture.execution.id,
    fixture.execution.attempt,
    {
      replay: observer,
      taskExecutor: config.taskExecutor,
      getTaskKey: config.taskKeyResolver,
      declaredSignalIds: getDeclaredDurableWorkflowSignalIds(task),
      getTaskPersistenceId: (child) =>
        config.workflowKeyResolver?.(child) ?? child.id,
    },
  );
  try {
    const run = () =>
      config.taskExecutor!.run(task, structuredClone(fixture.execution.input));
    await (config.contextProvider
      ? config.contextProvider(context, run)
      : run());
  } catch (error) {
    if (error !== boundary)
      issues.push(error instanceof Error ? error.message : String(error));
  }
  const missing = history.filter((entry) => !seen.has(entry.stepId));
  if (missing.length)
    issues.push(
      `Saved operations were not reached: ${missing.map((entry) => entry.stepId).join(", ")}.`,
    );
  return { compatible: issues.length === 0, matched, issues };
}
