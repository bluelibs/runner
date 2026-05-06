import type { JournalKeyBag } from "../../../defs";
import type {
  AnyResMwState,
  AnyTaskMwState,
  ReplaceTaskMwStateJournal,
} from "./types";

/**
 * Clones and patches the Task middleware state immutably.
 */
export function cloneTask<TState extends AnyTaskMwState>(
  s: TState,
  patch: Partial<TState>,
): TState;
export function cloneTask<
  TState extends AnyTaskMwState,
  TNextState extends AnyTaskMwState,
>(s: TState, patch: Partial<TNextState>): TNextState;
export function cloneTask<
  TState extends AnyTaskMwState,
  TNextState extends AnyTaskMwState = TState,
>(s: TState, patch: Partial<TNextState>): TNextState {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as TNextState;
}

/**
 * Clones task middleware state while changing only the declared journal bag type.
 */
export function cloneTaskWithJournal<
  TState extends AnyTaskMwState,
  TNextJournalKeys extends JournalKeyBag,
>(
  s: TState,
  journal: TNextJournalKeys,
): ReplaceTaskMwStateJournal<TState, TNextJournalKeys> {
  const next = {
    ...s,
    journal,
  };
  return Object.freeze({
    ...next,
  }) as ReplaceTaskMwStateJournal<TState, TNextJournalKeys>;
}

/**
 * Clones and patches the Resource middleware state immutably.
 */
export function cloneRes<TState extends AnyResMwState>(
  s: TState,
  patch: Partial<TState>,
): TState;
export function cloneRes<
  TState extends AnyResMwState,
  TNextState extends AnyResMwState,
>(s: TState, patch: Partial<TNextState>): TNextState;
export function cloneRes<
  TState extends AnyResMwState,
  TNextState extends AnyResMwState = TState,
>(s: TState, patch: Partial<TNextState>): TNextState {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as TNextState;
}

export { mergeArray } from "../shared/mergeUtils";
export { mergeDepsWithConfig as mergeDependencies } from "../shared/mergeUtils";
