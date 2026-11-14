import { durableExecutionInvariantError } from "../../../../errors";
import type { IDurableStore } from "../interfaces/store";
import type { IDurableContext } from "../interfaces/context";
import type { DurableCommandRecord } from "../interfaces/commands";
import type { StepResult, WorkflowState } from "../types";

/** Private staged state and checkpoint namespace for one command. */
export function createCommandStore(
  store: IDurableStore,
  initial: DurableCommandRecord,
) {
  let command = initial;
  let open = true;
  const prefix = `__command-step:${JSON.stringify(command.id)}:`;
  const assertOpen = () => {
    if (!open)
      return durableExecutionInvariantError.throw({
        message: "Command context is no longer active.",
      });
  };
  const saveState = async (record: WorkflowState): Promise<void> => {
    assertOpen();
    const updated = {
      ...command,
      stateInitialized: true,
      state: { value: structuredClone(record.state) },
    };
    if (!(await store.saveCommand!(updated)))
      return durableExecutionInvariantError.throw({
        message: "Command receipt no longer accepts state writes.",
      });
    command = updated;
  };
  const scoped = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "getWorkflowState")
        return async () =>
          command.state
            ? {
                executionId: command.executionId,
                state: structuredClone(command.state.value),
                updatedAt: command.createdAt,
              }
            : null;
      if (property === "saveWorkflowState") return saveState;
      if (property === "getStepResult")
        return (id: string, stepId: string) =>
          target.getStepResult(id, prefix + stepId);
      if (property === "saveStepResult")
        return (result: StepResult) => {
          assertOpen();
          return target.saveStepResult({
            ...result,
            stepId: prefix + result.stepId,
          });
        };
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function"
        ? (...args: unknown[]) => Reflect.apply(member, target, args)
        : member;
    },
  });
  return {
    store: scoped,
    get record() {
      return command;
    },
    assertOpen,
    close() {
      open = false;
    },
  };
}

/** Commands may await ordinary tasks and steps, but cannot create a second suspended workflow. */
export function commandContext(context: IDurableContext): IDurableContext {
  const unsupported = new Set<PropertyKey>([
    "sleep",
    "waitForSignal",
    "waitForExecution",
    "workflow",
    "continueAsNew",
    "rollback",
    "_eventStepId",
  ]);
  return new Proxy(context, {
    get(target, property, receiver) {
      if (unsupported.has(property))
        return () =>
          durableExecutionInvariantError.throw({
            message:
              "Tracked commands cannot suspend or start child workflows. Use a workflow for long-lived orchestration.",
          });
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
