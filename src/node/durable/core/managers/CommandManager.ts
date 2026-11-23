import { submitCommand } from "./commandClient";
import type { AnyTask } from "../../../../types/task";
import type { IDurableStore } from "../interfaces/store";
import type { DurableServiceConfig } from "../interfaces/service";
import type {
  DurableCommandOptions,
  DurableCommandRecord,
} from "../interfaces/commands";
import type { Execution } from "../types";
import { isExecutionTerminal } from "../types";
import { durableExecutionInvariantError } from "../../../../errors";
import { DurableContext } from "../DurableContext";
import { NoopEventBus } from "../../bus/NoopEventBus";
import { commandContext, createCommandStore } from "./commandContext";
import type { TaskRegistry } from "./TaskRegistry";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import type { AttemptCancellationController } from "./AttemptCancellationController";
import { SuspensionSignal } from "../interfaces/context";
import { isDurablePauseInterruptionError } from "../pauseInterruption";
import { isDurableShutdownInterruptionError } from "../shutdownInterruption";
import { cancellationError } from "../../../../errors";

/** Tracked requests reuse the target's execution lease; receipts outlive collected history. */
export class CommandManager {
  constructor(
    private readonly config: DurableServiceConfig,
    private readonly tasks: TaskRegistry,
    private readonly kickoff: (id: string) => Promise<void>,
    private readonly cancellation: AttemptCancellationController,
  ) {}

  async command(
    executionId: string,
    task: AnyTask,
    input: unknown,
    options?: DurableCommandOptions,
  ): Promise<unknown> {
    return submitCommand(
      {
        config: this.config,
        tasks: this.tasks,
        kickoff: this.kickoff,
        rejectPending: (id, message) => this.rejectPending(id, message),
      },
      executionId,
      task,
      input,
      options,
    );
  }

  private async complete(
    store: IDurableStore,
    command: DurableCommandRecord,
    expected?: Execution,
  ): Promise<boolean> {
    const committed = await store.completeCommand!(command, expected);
    if (committed) {
      try {
        await this.config.eventBus?.publish(`command:${command.id}`, {
          type: "finished",
          payload: null,
          timestamp: new Date(),
        });
      } catch {
        // The receipt is durable; polling covers missed notifications.
      }
    }
    return committed;
  }

  async rejectPending(id: string, message: string): Promise<void> {
    const store = this.config.store;
    if (!store.getNextCommand || !store.completeCommand) return;
    for (
      let next = await store.getNextCommand(id);
      next;
      next = await store.getNextCommand(id)
    ) {
      if (
        !(await this.complete(store, {
          ...next,
          status: "failed",
          error: { message },
          completedAt: new Date(),
        }))
      )
        break;
    }
  }

  async drain(
    execution: Execution,
    workflow: AnyTask,
    owned: IDurableStore,
    lock: ExecutionLockState,
  ): Promise<"settled" | "parked"> {
    if (!owned.getNextCommand) return "settled";
    for (
      let request = await owned.getNextCommand(execution.id);
      request;
      request = await owned.getNextCommand(execution.id)
    ) {
      if (lock.lost) throw lock.lossError;
      const target = await owned.getExecution(execution.id);
      if (
        !target ||
        isExecutionTerminal(target.status) ||
        target.status === "cancelling"
      ) {
        await this.rejectPending(execution.id, "Target workflow is closed.");
        return "settled";
      }
      if (target.status === "paused") return "parked";
      const task = this.tasks.findCommand(workflow, request.taskKey);
      if (!task) {
        await this.complete(owned, {
          ...request,
          status: "failed",
          error: {
            message: "Command is no longer declared by this workflow version.",
          },
          completedAt: new Date(),
        });
        continue;
      }
      if (!this.config.taskExecutor)
        return durableExecutionInvariantError.throw({
          message: "Commands require a task executor.",
        });
      if (request.state === undefined) {
        const state = await owned.getWorkflowState?.(execution.id);
        request = {
          ...request,
          state: state ? { value: state.state } : null,
        };
      }
      request = { ...request, status: "running" };
      if (!(await owned.saveCommand!(request))) continue;
      const staged = createCommandStore(owned, request);
      const cancellation = await this.cancellation.registerAttemptCancellation({
        executionId: execution.id,
        pausedAt: target.pausedAt,
      });
      const context = commandContext(
        new DurableContext(
          staged.store,
          new NoopEventBus(),
          execution.id,
          execution.attempt,
          {
            taskExecutor: this.config.taskExecutor,
            stepIdentity: request.id,
            executionLockState: lock,
            cancellationSignal: cancellation.signal,
            assertLockOwnership: () => {
              staged.assertOpen();
              if (lock.lost) throw lock.lossError;
            },
          },
        ),
      );
      try {
        const provider =
          this.config.contextProvider ?? ((_context, fn) => fn());
        const result = await Promise.race([
          Promise.resolve(
            provider(context, () =>
              this.config.taskExecutor!.run(task, request!.input, {
                signal: cancellation.signal,
                kind: "command",
              }),
            ),
          ),
          lock.waitForLoss,
        ]);
        if (cancellation.signal.aborted)
          throw cancellationError.new({
            reason: String(cancellation.signal.reason),
          });
        let latest = await owned.getExecution(execution.id);
        let committed = false;
        for (let commitAttempt = 0; commitAttempt < 5; commitAttempt += 1) {
          if (latest?.status === "paused") return "parked";
          if (
            !latest ||
            isExecutionTerminal(latest.status) ||
            latest.status === "cancelling" ||
            latest.attempt !== target.attempt ||
            latest.workflowVersion !== target.workflowVersion
          ) {
            break;
          }
          committed = await this.complete(
            owned,
            {
              ...staged.record,
              status: "completed",
              result,
              completedAt: new Date(),
            },
            latest,
          );
          if (committed) break;
          const refreshed = await owned.getExecution(execution.id);
          if (refreshed?.status === "paused") return "parked";
          // Only retry when an unrelated background write (e.g. sleep/signal clearing
          // `current`) updated `current`/`updatedAt` without changing execution lifecycle.
          const benignChange =
            refreshed !== null &&
            refreshed.status === latest.status &&
            refreshed.attempt === latest.attempt &&
            refreshed.workflowVersion === latest.workflowVersion &&
            refreshed.pausedAt?.getTime() === latest.pausedAt?.getTime() &&
            (refreshed.updatedAt.getTime() !== latest.updatedAt.getTime() ||
              refreshed.current !== latest.current);
          if (!benignChange) break;
          latest = refreshed;
        }
        if (!committed) {
          await this.complete(owned, {
            ...staged.record,
            status: "failed",
            error: {
              message: "Target workflow changed before the command committed.",
            },
            completedAt: new Date(),
          });
        }
      } catch (error) {
        if (
          lock.lost ||
          isDurablePauseInterruptionError(error) ||
          isDurableShutdownInterruptionError(
            error,
            this.cancellation.getShutdownInterruptionReason(),
          ) ||
          (error instanceof SuspensionSignal &&
            error.reason === "step-concurrency")
        )
          return "parked";
        await this.complete(owned, {
          ...staged.record,
          status: "failed",
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
          completedAt: new Date(),
        });
      } finally {
        staged.close();
        cancellation.stop();
      }
    }
    return "settled";
  }
}
