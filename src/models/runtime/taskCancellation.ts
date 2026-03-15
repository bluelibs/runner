import { journal } from "../ExecutionJournal";
import type { ExecutionJournal } from "../../types/executionJournal";
import {
  linkAbortSignals,
  type AbortSignalLink,
} from "../../tools/abortSignals";

/**
 * Per-journal cancellation state for a task execution tree.
 *
 * Nested task calls can forward the same journal while each layer contributes
 * its own caller-provided signal. We therefore keep the raw signal stack plus a
 * current composed link that can be rebuilt whenever a nested layer enters or
 * leaves.
 */
interface TaskCallerSignalState {
  activeSignals: AbortSignal[];
  currentLink: AbortSignalLink;
}

export const taskCancellationJournalKeys = {
  callerSignal: journal.createKey<TaskCallerSignalState>(
    "runner.execution.abortSignal",
  ),
  abortController: journal.createKey<AbortController>(
    "runner.middleware.timeout.abortController",
  ),
} as const;

/**
 * Lazily initializes the shared caller-signal state for a journal.
 */
function getOrCreateCallerSignalState(
  executionJournal: ExecutionJournal,
): TaskCallerSignalState {
  const existing = executionJournal.get(
    taskCancellationJournalKeys.callerSignal,
  );
  if (existing) {
    return existing;
  }

  const state: TaskCallerSignalState = {
    activeSignals: [],
    currentLink: {
      signal: undefined,
      cleanup() {},
    },
  };
  executionJournal.set(taskCancellationJournalKeys.callerSignal, state);
  return state;
}

/**
 * Rebuilds the composed caller signal after the active signal stack changes.
 *
 * We re-link from scratch instead of trying to mutate listeners incrementally
 * because nested task calls can add/remove the same signal instance in
 * different stack frames, and the full rebuild keeps cleanup deterministic.
 */
function refreshCallerSignalState(state: TaskCallerSignalState): void {
  state.currentLink.cleanup();
  state.currentLink = linkAbortSignals(state.activeSignals);
}

/**
 * Adds a caller-provided signal to the journal-wide cancellation chain.
 *
 * The returned cleanup function must run when that call frame finishes so
 * sibling/nested task executions stop inheriting a signal that no longer
 * belongs to them. Cleanup is idempotent because `finally()` paths may race
 * with error handling.
 */
export function setTaskCallerSignal(
  executionJournal: ExecutionJournal,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) {
    return () => {};
  }

  const state = getOrCreateCallerSignalState(executionJournal);
  state.activeSignals.push(signal);
  refreshCallerSignalState(state);

  return () => {
    const signalIndex = state.activeSignals.lastIndexOf(signal);
    if (signalIndex === -1) {
      return;
    }

    state.activeSignals.splice(signalIndex, 1);
    refreshCallerSignalState(state);
  };
}

/**
 * Returns the timeout middleware's shared abort controller for this journal,
 * creating it on first access so all middleware layers cooperate on the same
 * task-local cancellation path.
 */
export function getOrCreateTaskAbortController(
  executionJournal: ExecutionJournal,
): AbortController {
  const existing = executionJournal.get(
    taskCancellationJournalKeys.abortController,
  );
  if (existing) {
    return existing;
  }

  const controller = new AbortController();
  executionJournal.set(taskCancellationJournalKeys.abortController, controller);
  return controller;
}

/**
 * Builds the effective task signal seen by task code and cooperating middleware.
 *
 * This composes caller-provided signals with the task-local abort controller.
 * Callers own the returned link and must invoke `cleanup()` because composing
 * multiple sources may install temporary abort listeners.
 */
export function getTaskAbortSignalLink(
  executionJournal: ExecutionJournal,
): AbortSignalLink {
  const callerSignalState = executionJournal.get(
    taskCancellationJournalKeys.callerSignal,
  );
  return linkAbortSignals([
    callerSignalState?.currentLink.signal,
    executionJournal.get(taskCancellationJournalKeys.abortController)?.signal,
  ]);
}
