import type { AnyTask } from "../../../../types/task";
import type { DurableServiceConfig } from "../interfaces/service";
import type { DurableCommandOptions } from "../interfaces/commands";
import type { TaskRegistry } from "./TaskRegistry";
import { durableExecutionInvariantError } from "../../../../errors";
import { check, Match } from "../../../../tools/check";
import { ValidationHelper } from "../../../../models/middleware/ValidationHelper";
import { createExecutionId } from "../utils";
import { followContinuedExecutionChain } from "../continuedChain";
import { ExecutionStatus, isExecutionTerminal } from "../types";
import { waitForStoreResult } from "./waitForStoreResult";

interface CommandClientDeps {
  config: DurableServiceConfig;
  tasks: TaskRegistry;
  kickoff: (id: string) => Promise<void>;
  rejectPending: (id: string, message: string) => Promise<void>;
}

/** Admissions are durable even when a caller stops waiting for its receipt. */
export async function submitCommand(
  deps: CommandClientDeps,
  executionId: string,
  task: AnyTask,
  input: unknown,
  options: DurableCommandOptions = {},
): Promise<unknown> {
  check(options, {
    idempotencyKey: Match.Optional(Match.NonEmptyString),
    waitTimeoutMs: Match.Optional(Match.PositiveInteger),
  });
  const started = Date.now();
  const store = deps.config.store;
  if (
    !store.withExecutionOwnership ||
    !store.enqueueCommand ||
    !store.rescheduleCommandTimer ||
    !store.getCommand ||
    !store.getNextCommand ||
    !store.saveCommand ||
    !store.completeCommand
  )
    return durableExecutionInvariantError.throw({
      message:
        "Tracked commands require atomic ownership, command receipts, and command timer support on the durable store.",
    });
  const taskKey = deps.tasks.getTaskKey(task);
  const id = JSON.stringify([
    executionId,
    taskKey,
    options.idempotencyKey ?? createExecutionId(),
  ]);
  const existingReceipt = await store.getCommand(id);
  const receipt =
    existingReceipt ??
    (await (async () => {
      let source = await store.getExecution(executionId);
      if (!source)
        return durableExecutionInvariantError.throw({
          message: `Execution '${executionId}' does not exist.`,
        });
      for (let attempt = 0; ; attempt += 1) {
        const target = await followContinuedExecutionChain(store, source);
        const workflow = deps.tasks.find(
          target.workflowKey,
          target.workflowVersion,
        );
        if (!deps.tasks.findCommand(workflow, taskKey))
          return durableExecutionInvariantError.throw({
            message: `Command '${taskKey}' is not declared by this workflow version.`,
          });
        ValidationHelper.validateInput(
          input,
          task.inputSchema,
          taskKey,
          "Task",
        );
        try {
          return await store.enqueueCommand!({
            id,
            executionId: target.id,
            requestedExecutionId: executionId,
            taskKey,
            ...(target.workflowVersion === undefined
              ? {}
              : { workflowVersion: target.workflowVersion }),
            input,
            status: "pending",
            createdAt: new Date(),
          });
        } catch (error) {
          const refreshed = await store.getExecution(target.id);
          if (
            refreshed?.status === ExecutionStatus.ContinuedAsNew &&
            refreshed.continuedAsExecutionId &&
            attempt < 4
          ) {
            source = refreshed;
            continue;
          }
          throw error;
        }
      }
    })());
  if (receipt.status === "pending" || receipt.status === "running") {
    void deps.kickoff(receipt.executionId).catch(() => {
      /* The persisted timer retries failed dispatch. */
    });
  }
  const channel = `command:${id}`;
  const readReceipt = async (): Promise<
    { done: false; channel: string } | { done: true; value: unknown }
  > => {
    while (true) {
      const current = await store.getCommand!(id);
      if (!current)
        return durableExecutionInvariantError.throw({
          message: "Command receipt disappeared.",
        });
      if (current.status === "completed")
        return { done: true, value: current.result };
      if (current.status === "failed")
        return durableExecutionInvariantError.throw({
          message: current.error!.message,
        });
      const target = await store.getExecution(current.executionId);
      if (
        !target ||
        isExecutionTerminal(target.status) ||
        target.status === "cancelling"
      ) {
        await deps.rejectPending(
          current.executionId,
          "Target workflow is closed.",
        );
        continue;
      }
      return { done: false, channel };
    }
  };
  return waitForStoreResult({
    check: readReceipt,
    channel,
    eventBus: deps.config.eventBus,
    startedAt: started,
    timeoutMs: options.waitTimeoutMs,
    pollEveryMs: 500,
    buildTimeoutError: async () =>
      durableExecutionInvariantError.new({
        message: "Command wait timed out; the durable request remains pending.",
      }),
  });
}
